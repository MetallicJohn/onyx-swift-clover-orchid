-- WhatsApp payment prompts. Off until the ISP turns them on. Does not mark invoices paid.

alter table whatsapp_agent_settings
  add column if not exists payment_prompt_enabled boolean not null default false;
