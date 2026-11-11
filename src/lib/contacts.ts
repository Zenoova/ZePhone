import type { Contact } from "@/types/telephony";

export function contactName(c: Pick<Contact, "firstName" | "lastName" | "company" | "number">): string {
  return `${c.firstName} ${c.lastName}`.trim() || c.company || c.number;
}
