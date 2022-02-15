import { InvalidUsdCents, NonIntegerError } from "@domain/errors"

export const toCents = (amount: number): UsdCents => {
  return amount as UsdCents
}

export const checkedtoCents = (amount: number): UsdCents | ValidationError => {
  if (!(amount && amount > 0)) return new InvalidUsdCents()
  if (!Number.isInteger(amount))
    return new NonIntegerError(`${amount} type ${typeof amount} is not an integer`)
  return toCents(amount)
}

export const OrderType = {
  Locked: "immediate",
  Active: "quote",
} as const