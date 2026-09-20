import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatKas(amount: number | undefined | null) {
  if (amount === undefined || amount === null) return "0.00 KAS"
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(amount) + " KAS"
}

export function formatUsd(amount: number | undefined | null) {
  if (amount === undefined || amount === null) return "$0.00"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export function formatPercent(amount: number | undefined | null) {
  if (amount === undefined || amount === null) return "0.00%"
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + "%"
}
