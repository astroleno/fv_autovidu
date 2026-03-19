/**
 * Button 按钮组件
 * Stitch 报纸风格：0px 圆角、newsprint-border、hover 硬阴影 + translate(-2px,-2px)
 * 4 种变体：primary / secondary / danger / ghost
 */
import type { ButtonHTMLAttributes } from "react"

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  children: React.ReactNode
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-newsprint-black)] text-[var(--color-newsprint-off-white)] border border-[var(--color-newsprint-black)] hover:bg-[var(--color-primary)] hover:text-white hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
  secondary:
    "bg-transparent text-[var(--color-newsprint-black)] border border-[var(--color-newsprint-black)] hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
  danger:
    "bg-[var(--color-error)] text-white border border-[var(--color-newsprint-black)] hover:shadow-[4px_4px_0px_0px_#111111] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
  ghost:
    "bg-transparent text-[var(--color-ink)] border border-transparent hover:border-[var(--color-newsprint-black)] hover:bg-[var(--color-outline-variant)]",
}

export function Button({
  variant = "primary",
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 px-4 py-2 font-bold text-xs uppercase tracking-widest transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed box-border"

  return (
    <button
      type="button"
      className={`${base} ${variantStyles[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
