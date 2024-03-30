import { MEMO_PAYMENT_MERCHANT_PAYOUT, MEMO_PAYMENT_REFERRAL_PAYOUT } from "@config"
import { isForwardedMemo } from "./tx-history"

describe("tx-history", () => {
  describe("isForwardedMemo", () => {
    it("should return true if memo is forwarded for a merchant payout", () => {
      expect(isForwardedMemo(MEMO_PAYMENT_MERCHANT_PAYOUT)).toBe(true)
    })

    it("should return true if memo is forwarded for a referral payout", () => {
      expect(isForwardedMemo(MEMO_PAYMENT_REFERRAL_PAYOUT)).toBe(true)
    })

    it("should return false if memo is not forwarded for a merchant payout", () => {
      expect(isForwardedMemo("Forwarded from Guy Fieri")).toBe(false)
    })
  })
})
