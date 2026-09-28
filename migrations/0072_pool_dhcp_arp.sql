-- Router-specific pool behaviour. Defaults keep existing pools on normal ARP with Option 43 off.

alter table ip_pools add column if not exists dhcp_option_43_enabled boolean not null default false;
alter table ip_pools add column if not exists dhcp_option_43_value text not null default '';
alter table ip_pools add column if not exists dhcp_option_43_format text not null default 'hex';
alter table ip_pools add column if not exists static_arp_mode text not null default 'normal';

do $$
begin
  alter table ip_pools add constraint ip_pools_static_arp_mode_chk
    check (static_arp_mode in ('normal', 'reply_only'));
exception
  when duplicate_object then null;
end $$;
