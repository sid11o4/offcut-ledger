import { STAGE_CLS } from '../lib/util'

export const StagePill = ({ stage }) => <span className={'pill ' + (STAGE_CLS[stage] || 's-contacted')}>{stage}</span>
export const Prio = ({ p }) => (p ? <span className={'prio ' + p}>{p}</span> : null)

export const WaIcon = (props) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M8 1.3a6.6 6.6 0 0 0-5.7 9.9L1.3 14.7l3.6-.9A6.6 6.6 0 1 0 8 1.3Zm0 12a5.4 5.4 0 0 1-2.8-.8l-.2-.1-2.1.6.6-2.1-.1-.2A5.4 5.4 0 1 1 8 13.3Zm3-4c-.2-.1-1-.5-1.1-.5-.2-.1-.3-.1-.4.1l-.5.6c-.1.1-.2.1-.4 0a4.4 4.4 0 0 1-2.2-1.9c-.2-.3.2-.3.5-1 .1-.1 0-.2 0-.3l-.5-1.2c-.1-.3-.3-.3-.4-.3h-.3a.6.6 0 0 0-.5.2 1.9 1.9 0 0 0-.6 1.4 3.3 3.3 0 0 0 .7 1.8 7.6 7.6 0 0 0 2.9 2.6c1.1.5 1.5.5 2 .4a1.7 1.7 0 0 0 1.1-.8 1.4 1.4 0 0 0 .1-.8c0-.1-.2-.1-.4-.2Z" />
  </svg>
)

export function Options({ list, blank }) {
  return (
    <>
      {blank !== undefined && <option value="">{blank}</option>}
      {list.map((o) => (typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
    </>
  )
}
