import { getKratosConfig } from "@config"

import { ErrorLevel } from "@domain/shared"
import { Configuration, V0alpha2Api, V0alpha2ApiInterface } from "@ory/client"
import { recordExceptionInCurrentSpan } from "@services/tracing"

import { MissingExpiredAtKratosError, UnknownKratosError } from "./errors"

const { publicApi, adminApi } = getKratosConfig()

const KratosSdk: (kratosEndpoint: string) => V0alpha2ApiInterface = (kratosEndpoint) =>
  new V0alpha2Api(new Configuration({ basePath: kratosEndpoint }))

export const kratosPublic = KratosSdk(publicApi)
export const kratosAdmin = KratosSdk(adminApi)

export const toDomainSession = (session: KratosSession): Session => {
  // is throw ok? this should not happen I (nb) believe but the type say it can
  // this may probably be a type issue in kratos SDK
  if (!session.expires_at) throw new MissingExpiredAtKratosError()

  return {
    id: session.id as SessionId,
    identity: toDomainIdentityPhone(session.identity),
  }
}

export const toDomainIdentityPhone = (identity: KratosIdentity): IdentityPhone => {
  let createdAt: Date
  if (identity.created_at) {
    createdAt = new Date(identity.created_at)
  } else {
    recordExceptionInCurrentSpan({
      error: "createdAt should always be set? type approximation from kratos",
      level: ErrorLevel.Critical,
    })
    createdAt = new Date()
  }

  return {
    id: identity.id as UserId,
    phone: identity.traits.phone as PhoneNumber,
    createdAt,
  }
}

export const listSessionsInternal = async (
  userId: UserId,
): Promise<KratosSession[] | KratosError> => {
  try {
    const res = await kratosAdmin.adminListIdentitySessions(userId)
    if (res.data === null) return []
    return res.data
  } catch (err) {
    return new UnknownKratosError(err)
  }
}