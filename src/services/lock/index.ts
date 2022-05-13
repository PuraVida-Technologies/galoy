import Redlock, { RedlockAbortSignal } from "redlock"

import { ResourceAttemptsLockServiceError } from "@domain/lock"
import { wrapAsyncFunctionsToRunInSpan } from "@services/tracing"

import { redis } from "@services/redis"

// the maximum amount of time you want the resource locked,
// keeping in mind that you can extend the lock up until
// the point when it expires
// TODO: use TIMEOUTs env variable
const ttl = process.env.NETWORK !== "regtest" ? 180000 : 10000

const redlockClient = new Redlock(
  // you should have one client for each independent redis node
  // or cluster
  [redis],
  {
    // the expected clock drift; for more details
    // see http://redis.io/topics/distlock
    driftFactor: 0.01, // time in ms

    // the max number of times Redlock will attempt
    // to lock a resource before erroring
    retryCount: 5,

    // the time in ms between attempts
    retryDelay: 400, // time in ms

    // the max time in ms randomly added to retries
    // to improve performance under high contention
    // see https://www.awsarchitectureblog.com/2015/03/backoff.html
    retryJitter: 200, // time in ms
  },
)

const getLockResource = (path) => `locks:account:${path}`

interface IRedLock {
  path: string
  signal?: RedlockAbortSignal
}

export const redlock = async ({ path, signal }: IRedLock, async_fn) => {
  if (signal) {
    if (signal.aborted) {
      return new ResourceAttemptsLockServiceError(signal.error?.message)
    }
    return async_fn(signal)
  }

  return redlockClient.using([getLockResource(path)], ttl, async (signal) => {
    if (signal) {
      if (signal.aborted) {
        return new ResourceAttemptsLockServiceError(signal.error?.message)
      }
      return async_fn(signal)
    } else {
      return new ResourceAttemptsLockServiceError()
    }
  })
}

export const LockService = (): ILockService => {
  const lockWalletId = async <Res>(
    { walletId, signal }: { walletId: WalletId; signal?: RedlockAbortSignal },
    f: (signal: WalletIdAbortSignal) => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    return redlock({ path: walletId, signal }, f)
  }

  const lockPaymentHash = async <Res>(
    { paymentHash }: { paymentHash: PaymentHash },
    f: (signal: PaymentHashAbortSignal) => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    return redlock({ path: paymentHash }, f)
  }

  const lockOnChainTxHash = async <Res>(
    { txHash }: { txHash: OnChainTxHash },
    f: (signal: OnChainTxAbortSignal) => Promise<Res>,
  ): Promise<Res | LockServiceError> => {
    return redlock({ path: txHash }, f)
  }

  return wrapAsyncFunctionsToRunInSpan({
    namespace: "services.lock",
    fns: {
      lockWalletId,
      lockPaymentHash,
      lockOnChainTxHash,
    },
  })
}
