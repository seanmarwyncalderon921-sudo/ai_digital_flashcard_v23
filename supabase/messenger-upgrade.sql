-- Messenger upgrade: add reaction storage and an atomic, server-only toggle RPC.
alter table public.chat_messages
  add column if not exists reactions jsonb not null default '{}'::jsonb;

create or replace function public.toggle_chat_message_reaction(
  p_conversation_id text,
  p_message_id text,
  p_user_id text,
  p_emoji text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  message_row public.chat_messages;
  next_reactions jsonb;
  reacting_users jsonb;
begin
  if p_emoji not in ('❤️', '😂', '😮', '😢', '😡', '👍') then
    raise exception 'Unsupported reaction';
  end if;
  select * into message_row
  from public.chat_messages
  where id = p_message_id and conversation_id = p_conversation_id
  for update;
  if not found then raise exception 'Message not found'; end if;
  if message_row.is_unsent then raise exception 'Message was unsent'; end if;

  next_reactions := coalesce(message_row.reactions, '{}'::jsonb);
  reacting_users := coalesce(next_reactions -> p_emoji, '[]'::jsonb);
  if reacting_users ? p_user_id then
    select coalesce(jsonb_agg(user_id), '[]'::jsonb) into reacting_users
    from jsonb_array_elements_text(reacting_users) as entries(user_id)
    where user_id <> p_user_id;
  else
    reacting_users := reacting_users || jsonb_build_array(p_user_id);
  end if;
  if jsonb_array_length(reacting_users) = 0 then
    next_reactions := next_reactions - p_emoji;
  else
    next_reactions := jsonb_set(next_reactions, array[p_emoji], reacting_users, true);
  end if;

  update public.chat_messages
  set reactions = next_reactions, updated_at = now()
  where id = p_message_id and conversation_id = p_conversation_id
  returning * into message_row;
  return message_row;
end;
$$;

revoke all on function public.toggle_chat_message_reaction(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.toggle_chat_message_reaction(text, text, text, text)
  to service_role;
