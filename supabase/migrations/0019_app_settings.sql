-- Singleton company/settings row used on printed estimates & bills (spec section 49).
-- Seeded with placeholder values -- an admin should update these from Masters > Company Info
-- before sending real documents to clients.

create table public.app_settings (
  id boolean primary key default true,
  company_name text not null default 'Formgrid Factory',
  company_address text,
  company_phone text,
  company_email text,
  company_gst_number text,
  default_tax_percent numeric(5,2) not null default 0,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  constraint chk_singleton check (id = true)
);
create trigger trg_app_settings_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();

alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select using (public.is_active_user());
create policy app_settings_update on public.app_settings for update using (public.has_permission('master_data'));

insert into public.app_settings (id, company_name, company_address, company_phone, company_email, company_gst_number, default_tax_percent)
values (true, 'Formgrid Factory', 'Address not yet configured — update in Masters > Company Info', null, null, null, 0);
