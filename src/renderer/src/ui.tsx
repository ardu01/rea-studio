import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { Check } from 'lucide-react'
import { twMerge } from 'tailwind-merge'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const buttonVariants = cva('btn', {
  variants: {
    variant: {
      default: '',
      secondary: 'secondary',
      ghost: 'ghost',
      danger: 'danger',
    },
  },
  defaultVariants: { variant: 'default' },
})

export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />
}

export function Field(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="field" {...props} />
}

export function Area(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="area" {...props} />
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="lbl">{children}</span>
}

export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={cn('pill', tone)}>{children}</span>
}

export function CheckRow({
  checked,
  onCheckedChange,
  children,
}: {
  checked: boolean
  onCheckedChange: (value: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="row" style={{ alignItems: 'flex-start' }}>
      <CheckboxPrimitive.Root className="check" checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)}>
        <CheckboxPrimitive.Indicator>
          <Check size={12} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span className="small" style={{ paddingTop: 1 }}>
        {children}
      </span>
    </label>
  )
}

export function ConfirmDialog({
  title,
  body,
  action,
  onConfirm,
}: {
  title: string
  body: string
  action: string
  onConfirm: () => void
}) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <Button variant="danger" type="button">
          {action}
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay" />
        <DialogPrimitive.Content className="modal">
          <DialogPrimitive.Title asChild>
            <h2>{title}</h2>
          </DialogPrimitive.Title>
          <p className="lead" style={{ fontSize: 15 }}>
            {body}
          </p>
          <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <DialogPrimitive.Close asChild>
              <Button variant="secondary" type="button">
                Cancelar
              </Button>
            </DialogPrimitive.Close>
            <DialogPrimitive.Close asChild>
              <Button type="button" onClick={onConfirm}>
                {action}
              </Button>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
