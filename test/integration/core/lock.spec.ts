import { redis } from "@services/redis"
import { baseLogger } from "@services/logger"

import { sleep } from "@utils"
import { redlock } from "@services/lock"

const walletId = "1234"

const checkLockExist = (client) =>
  new Promise((resolve) =>
    client.get(walletId, (err, res) => {
      resolve(!!res)
    }),
  )

describe("Lock", () => {
  describe("redlock", () => {
    it("return value is passed with a promise", async () => {
      const result = await redlock({ path: walletId }, () => {
        return "r"
      })

      expect(result).toBe("r")
    })

    it("use signal if this exist", async () => {
      const result = await redlock({ path: walletId }, (signal) => {
        return redlock({ path: walletId, signal }, () => {
          return "r"
        })
      })

      expect(result).toBe("r")
    })

    it("relocking fail if lock is not passed down the tree", async () => {
      await expect(
        redlock({ path: walletId }, async () => {
          return redlock({ path: walletId }, () => {
            return "r"
          })
        }),
      ).rejects.toThrow()
    })

    it("second loop start after first loop has ended", async () => {
      const order: number[] = []

      await Promise.all([
        redlock({ path: walletId }, async () => {
          order.push(1)
          await sleep(1000)
          order.push(2)
        }),
        redlock({ path: walletId }, async () => {
          order.push(3)
          await sleep(1000)
          order.push(4)
        }),
      ])

      expect(order).toStrictEqual([1, 2, 3, 4])
    })

    it("throwing error releases the lock", async () => {
      try {
        await redlock({ path: walletId }, async () => {
          expect(await checkLockExist(redis)).toBeTruthy()
          await sleep(500)
          throw Error("dummy error")
        })
      } catch (err) {
        baseLogger.info(`error is being caught ${err}`)
      }

      expect(await checkLockExist(redis)).toBeFalsy()
    })
  })
})
