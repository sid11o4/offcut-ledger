-- Track helpers are for signed-in users only; the trigger function is never called directly.
revoke all on function public.track_can_read(), public.track_is_admin(), public.track_is_member(), public.track_role(),
  public.track_create_boq_progress() from public, anon;
grant execute on function public.track_can_read(), public.track_is_admin(), public.track_is_member(), public.track_role() to authenticated;
revoke execute on function public.track_create_boq_progress() from authenticated;
alter function public.track_protect_default_category() set search_path = public;
