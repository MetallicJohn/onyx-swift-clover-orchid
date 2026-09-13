import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50 min-w-48 max-w-xs overflow-hidden rounded-md border border-border bg-elevated p-1 text-fg shadow-card outline-none",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  danger,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & { inset?: boolean; danger?: boolean }) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex min-h-11 cursor-pointer items-center rounded-sm px-3 text-sm outline-none select-none",
        "focus:bg-surface focus:text-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        danger ? "text-danger focus:text-danger" : "text-fg",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}

export function DropdownMenuLabel({ className, children }: { className?: string; children: ReactNode }) {
  return <DropdownMenuPrimitive.Label className={cn("px-3 py-2 text-xs font-medium text-muted", className)}>{children}</DropdownMenuPrimitive.Label>;
}
