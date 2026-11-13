// ============================================================
// Edge Function: reset-password
// ============================================================
// Called by src/components/EditUserModal.jsx ("Edit User" -> new password) via
//   POST {SUPABASE_URL}/functions/v1/reset-password
//   Headers: Authorization: Bearer <caller's access token>
//   Body: { user_id, new_password }
//
// Only an Admin may call it. The caller's token is verified, their role is
// read from `profiles`, and the target user's password is changed with the
// service-role key (which never leaves the server).
//
// Deploy:  supabase functions deploy reset-password
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected
// automatically by Supabase — no manual secrets needed.)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
    if (!token) {
      return json({ error: 'Missing authorization token.' }, 401)
    }

    // 1. Is the caller's session valid?
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser(token)
    if (userError || !userData?.user) {
      return json({ error: 'Invalid or expired session. Please refresh the page and try again.' }, 401)
    }

    // 2. Is the caller an Admin?
    const adminClient = createClient(supabaseUrl, serviceRoleKey)
    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()
    if (profileError || callerProfile?.role !== 'admin') {
      return json({ error: 'Only Admins can reset passwords.' }, 403)
    }

    // 3. Validate input
    const { user_id, new_password } = await req.json()
    if (!user_id || !new_password) {
      return json({ error: 'user_id and new_password are required.' }, 400)
    }
    if (String(new_password).length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400)
    }

    // 4. Change the password
    const { error: updateError } = await adminClient.auth.admin.updateUserById(user_id, {
      password: new_password
    })
    if (updateError) {
      return json({ error: updateError.message }, 400)
    }

    return json({ success: true })
  } catch (err) {
    return json({ error: (err as Error)?.message || 'Unexpected server error.' }, 500)
  }
})
