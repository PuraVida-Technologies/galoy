import { UnknownLockServiceError } from "@domain/lock"
import { lockExtendOrThrow, redlock } from "@core/lock"
import { asyncRunInSpan } from "@services/tracing"

export const LockService = (): ILockService => {
  const lockWalletId = async <Res>(
    {
      walletId,
      logger,
      lock,
    }: { walletId: WalletId; logger: Logger; lock?: DistributedLock },
    f: () => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    try {
      return asyncRunInSpan("redlock", { walletId }, () =>
        redlock({ path: walletId, logger, lock }, f),
      )
    } catch (err) {
      return new UnknownLockServiceError(err)
    }
  }

  const lockPaymentHash = async <Res>(
    {
      paymentHash,
      logger,
      lock,
    }: { paymentHash: PaymentHash; logger: Logger; lock?: DistributedLock },
    f: () => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    try {
      return asyncRunInSpan("redlock", { paymentHash }, () =>
        redlock({ path: paymentHash, logger, lock }, f),
      )
    } catch (err) {
      return new UnknownLockServiceError(err)
    }
  }

  const lockOnChainTxHash = async <Res>(
    {
      txHash,
      logger,
      lock,
    }: { txHash: OnChainTxHash; logger: Logger; lock?: DistributedLock },
    f: (lock?: DistributedLock) => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    try {
      return asyncRunInSpan("redlock", { txHash }, () =>
        redlock({ path: txHash, logger, lock }, f),
      )
    } catch (err) {
      return new UnknownLockServiceError(err)
    }
  }

  const extendLock = async <Res>(
    { lock, logger }: { lock: DistributedLock; logger: Logger },
    f: () => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    try {
      return asyncRunInSpan(
        "redlock",
        { extend: true },
        () => lockExtendOrThrow({ lock, logger }, f) as Promise<Res>,
      )
    } catch (err) {
      return new UnknownLockServiceError(err)
    }
  }

  return {
    lockWalletId,
    lockPaymentHash,
    lockOnChainTxHash,
    extendLock,
  }
}
