import { addNewContact } from "@app/accounts/add-new-contact"
import { getCurrentPrice } from "@app/prices"
import { PaymentSendStatus } from "@domain/bitcoin/lightning"
import { InsufficientBalanceError, NotImplementedError } from "@domain/errors"
import { DisplayCurrencyConverter } from "@domain/fiat/display-currency"
import { checkedToWalletId, PaymentInputValidator } from "@domain/wallets"
import { WalletCurrency } from "@domain/shared"
import { LedgerService } from "@services/ledger"
import { LockService } from "@services/lock"
import {
  AccountsRepository,
  UsersRepository,
  WalletsRepository,
} from "@services/mongoose"
import { NotificationsService } from "@services/notifications"

import { toSats } from "@domain/bitcoin"

import { AccountValidator } from "@domain/accounts"
import { checkedToBtcPaymentAmount, checkedToUsdPaymentAmount } from "@domain/payments"
import { constructPaymentFlowBuilder } from "@app/payments/helpers"
import { addAttributesToCurrentSpan } from "@services/tracing"
import { NewDealerPriceService } from "@services/dealer-price"

import { checkAndVerifyTwoFA, checkIntraledgerLimits } from "./check-limit-helpers"

const dealer = NewDealerPriceService()

export const intraledgerPaymentSendUsername = async ({
  recipientUsername,
  amount,
  memo,
  senderWalletId,
  senderAccount,
  logger,
}: IntraLedgerPaymentSendUsernameArgs): Promise<PaymentSendStatus | ApplicationError> => {
  return intraLedgerSendPaymentUsername({
    senderAccount,
    senderWalletId,
    recipientUsername,
    amount,
    memo: memo || "",
    logger,
  })
}

export const intraledgerPaymentSendWalletId = async ({
  recipientWalletId,
  senderAccount,
  amount,
  memo,
  senderWalletId,
  logger,
}: IntraLedgerPaymentSendWalletIdArgs): Promise<PaymentSendStatus | ApplicationError> => {
  return executePaymentViaIntraledger({
    senderWalletId,
    senderAccount,
    recipientUsername: null,
    recipientWalletId,
    amount,
    memoPayer: memo || "",
    logger,
  })
}

// FIXME: unused currently
export const intraledgerSendPaymentUsernameWithTwoFA = async ({
  twoFAToken,
  recipientUsername,
  senderAccount,
  amount,
  memo,
  senderWalletId,
  logger,
}: IntraLedgerPaymentSendWithTwoFAArgs): Promise<
  PaymentSendStatus | ApplicationError
> => {
  const user = await UsersRepository().findById(senderAccount.ownerId)
  if (user instanceof Error) return user
  const { twoFA } = user

  // FIXME: inefficient. wallet also fetched in lnSendPayment
  const senderWallet = await WalletsRepository().findById(senderWalletId)
  if (senderWallet instanceof Error) return senderWallet

  const displayCurrencyPerSat = await getCurrentPrice()
  if (displayCurrencyPerSat instanceof Error) return displayCurrencyPerSat

  const dCConverter = DisplayCurrencyConverter(displayCurrencyPerSat)
  // End FIXME

  const twoFACheck = twoFA?.secret
    ? await checkAndVerifyTwoFA({
        amount,
        dCConverter,
        twoFAToken: twoFAToken ? (twoFAToken as TwoFAToken) : null,
        twoFASecret: twoFA.secret,
        walletId: senderWalletId,
        walletCurrency: senderWallet.currency,
        account: senderAccount,
      })
    : true
  if (twoFACheck instanceof Error) return twoFACheck

  return intraLedgerSendPaymentUsername({
    senderAccount,
    senderWalletId,
    recipientUsername,
    amount,
    memo: memo || "",
    logger,
  })
}

const intraLedgerSendPaymentUsername = async ({
  senderWalletId,
  senderAccount,
  recipientUsername,
  amount,
  memo,
  logger,
}: {
  senderAccount: Account
  senderWalletId: WalletId
  recipientUsername: Username
  amount: Satoshis
  memo: string
  logger: Logger
}) => {
  const recipientAccount = await AccountsRepository().findByUsername(recipientUsername)
  if (recipientAccount instanceof Error) return recipientAccount

  const paymentSendStatus = await executePaymentViaIntraledger({
    senderWalletId,
    recipientUsername,
    recipientWalletId: recipientAccount.defaultWalletId,
    amount,
    memoPayer: memo || "",
    senderAccount,
    logger,
  })
  if (paymentSendStatus instanceof Error) return paymentSendStatus

  const addContactToPayerResult = await addNewContact({
    accountId: senderAccount.id,
    contactUsername: recipientUsername,
  })
  if (addContactToPayerResult instanceof Error) return addContactToPayerResult

  if (senderAccount.username) {
    const recipientAccount = await AccountsRepository().findByUsername(recipientUsername)
    if (recipientAccount instanceof Error) return recipientAccount

    const addContactToPayeeResult = await addNewContact({
      accountId: recipientAccount.id,
      contactUsername: senderAccount.username,
    })
    if (addContactToPayeeResult instanceof Error) return addContactToPayeeResult
  }

  return paymentSendStatus
}

const executePaymentViaIntraledger = async ({
  senderWalletId,
  senderAccount,
  recipientUsername,
  recipientWalletId,
  amount: amountRaw,
  memoPayer,
  logger,
}: {
  senderWalletId: WalletId
  senderAccount: Account
  recipientUsername: Username | null
  recipientWalletId: WalletId
  amount: Satoshis
  memoPayer: string
  logger: Logger
}): Promise<PaymentSendStatus | ApplicationError> => {
  const validator = PaymentInputValidator(WalletsRepository().findById)
  const validationResult = await validator.validatePaymentInput({
    amount: amountRaw,
    senderAccount,
    senderWalletId,
    recipientWalletId,
  })
  if (validationResult instanceof Error) return validationResult

  const { amount, senderWallet, recipientWallet } = validationResult

  // TODO Usd use case
  if (
    !(
      recipientWallet.currency === WalletCurrency.Btc &&
      senderWallet.currency === WalletCurrency.Btc
    )
  ) {
    return new NotImplementedError("USD intraledger")
  }
  const amountSats = toSats(amount)

  const displayCurrencyPerSat = await getCurrentPrice()
  if (displayCurrencyPerSat instanceof Error) return displayCurrencyPerSat

  const dCConverter = DisplayCurrencyConverter(displayCurrencyPerSat)

  const intraledgerLimitCheck = await checkIntraledgerLimits({
    amount,
    dCConverter,
    walletId: senderWallet.id,
    walletCurrency: senderWallet.currency,
    account: senderAccount,
  })

  if (intraledgerLimitCheck instanceof Error) return intraledgerLimitCheck

  const amountDisplayCurrency = dCConverter.fromSats(amountSats)

  return LockService().lockWalletId(
    { walletId: senderWalletId, logger },
    async (lock) => {
      const balance = await LedgerService().getWalletBalance(senderWalletId)
      if (balance instanceof Error) return balance
      if (balance < amount) {
        return new InsufficientBalanceError(
          `Payment amount '${amount}' exceeds balance '${balance}'`,
        )
      }

      const journal = await LockService().extendLock({ logger, lock }, async () =>
        LedgerService().addWalletIdIntraledgerTxTransfer({
          senderWalletId,
          senderWalletCurrency: senderWallet.currency,
          senderUsername: senderAccount.username,
          description: "",
          sats: amountSats,
          amountDisplayCurrency,
          recipientWalletId,
          recipientWalletCurrency: recipientWallet.currency,
          recipientUsername: recipientUsername || undefined,
          memoPayer,
        }),
      )
      if (journal instanceof Error) return journal

      const notificationsService = NotificationsService(logger)
      notificationsService.intraLedgerPaid({
        senderWalletId,
        recipientWalletId,
        amount: amountSats,
        displayCurrencyPerSat,
      })

      return PaymentSendStatus.Success
    },
  )
}

export const validateIntraledgerPaymentInputs = async ({
  amount,
  uncheckedSenderWalletId,
  senderAccount,
}) => {
  const senderWalletId = checkedToWalletId(uncheckedSenderWalletId)
  if (senderWalletId instanceof Error) return senderWalletId

  const senderWallet = await WalletsRepository().findById(senderWalletId)
  if (senderWallet instanceof Error) return senderWallet

  const accountValidated = AccountValidator().validateAccount({
    account: senderAccount,
    accountIdFromWallet: senderWallet.accountId,
  })
  if (accountValidated instanceof Error) return accountValidated

  const inputPaymentAmount =
    senderWallet.currency === WalletCurrency.Btc
      ? checkedToBtcPaymentAmount(amount)
      : checkedToUsdPaymentAmount(amount)
  if (inputPaymentAmount instanceof Error) return inputPaymentAmount

  const builderWithConversion = await constructPaymentFlowBuilder({
    uncheckedAmount: amount,
    senderWallet,
    invoice: decodedInvoice,
    usdFromBtc: dealer.getCentsFromSatsForImmediateBuy,
    btcFromUsd: dealer.getSatsFromCentsForImmediateSell,
  })
  if (builderWithConversion instanceof Error) return builderWithConversion

  const paymentFlow = await builderWithConversion.withoutRoute()
  if (paymentFlow instanceof Error) return paymentFlow

  if (paymentFlow instanceof Error) return paymentFlow

  addAttributesToCurrentSpan({
    "payment.amount": paymentFlow.btcPaymentAmount.amount.toString(),
    "payment.request.destination": decodedInvoice.destination,
    "payment.request.hash": decodedInvoice.paymentHash,
    "payment.request.description": decodedInvoice.description,
    "payment.request.expiresAt": decodedInvoice.expiresAt
      ? decodedInvoice.expiresAt.toISOString()
      : "undefined",
  })

  return {
    senderWallet,
    paymentFlow,
    decodedInvoice,
  }
}
