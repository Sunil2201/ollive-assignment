"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

function Dialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />
}

function DialogTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger {...props} />
}

function DialogBackdrop({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DialogPopup({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogBackdrop />
      <DialogPrimitive.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "w-full max-w-md rounded-xl bg-white border border-[#E2E8F0]",
          "shadow-[0_8px_32px_rgba(0,0,0,0.12)] p-6",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          "origin-center",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      className={cn("text-[15px] font-semibold text-[#0F172A] mb-1", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      className={cn("text-[13px] text-[#64748B] leading-relaxed mb-5", className)}
      {...props}
    />
  )
}

function DialogClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close {...props} />
}

export {
  Dialog,
  DialogTrigger,
  DialogBackdrop,
  DialogPopup,
  DialogTitle,
  DialogDescription,
  DialogClose,
}
