// Turn a Postgres/PostgREST error from a delete attempt into something a factory user can act
// on, instead of surfacing "violates foreign key constraint ...". 23503 = foreign_key_violation:
// the row is still referenced by real data, so it can't be hard-deleted -- deactivating it is
// the right move (spec section 54: understandable messages, no raw DB errors).
export function deleteErrorMessage(error, noun = 'This item') {
  if (!error) return null
  if (error.code === '23503') {
    return `${noun} can't be deleted because other records still reference it. Deactivate it instead — it stays out of new entries but its history is kept.`
  }
  return error.message || 'Delete failed.'
}
