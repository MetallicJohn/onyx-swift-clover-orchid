-- Default MikroTik API user for new routers. Existing rows keep their value.

alter table routers alter column api_user set default 'ispsolutions';
