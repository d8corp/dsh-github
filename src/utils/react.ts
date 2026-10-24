import type * as ReactTypes from 'react'

let react: typeof ReactTypes

export function getReact () {
  return react
}

export function setReact (value: typeof ReactTypes) {
  react = value
}
