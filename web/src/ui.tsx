import * as Dialog from "@radix-ui/react-dialog";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return twMerge(clsx(values));
}

const button = cva("inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50", {
  variants: {
    variant: {
      primary: "bg-[#0b5d43] text-white",
      quiet: "bg-white text-[#1b1914] border border-[#cfc6b8]",
      danger: "bg-[#8d2f2f] text-white",
    },
  },
  defaultVariants: { variant: "primary" },
});

export function Button({ variant, className, asChild, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(button({ variant }), className)} {...props} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}

export const controlClass = "rounded-md border border-[#cfc6b8] bg-white px-3 py-2";

export function DialogConfirm({ title, trigger, children, onConfirm }: { title: string; trigger: ReactNode; children: ReactNode; onConfirm: () => void }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg bg-[#fffdf8] p-5 shadow-lg">
          <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6">{children}</Dialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close asChild><Button variant="quiet">取消</Button></Dialog.Close>
            <Dialog.Close asChild><Button variant="danger" onClick={onConfirm}>确认</Button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
