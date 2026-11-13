// ============================================================
// Edge Function: create-user
// ============================================================
// Called by src/components/UserFormModal.jsx ("Add New User" form) via
//   POST {SUPABASE_URL}/functions/v1/create-user
//   Headers: Authorization: Bearer <caller's access token>
//   Body: { email, password, full_name, role }
//
// Only an Admin may call it. Flow:
//   1. verify the caller's session token
//   2. confirm the caller's role is 'admin' (read with the service-role key)
//   3. create the Auth user  -> the handle_new_user() database trigger
//      automatically inserts a `profiles` row, but always with role 'bde'
//   4. UPDATE that profile row to the role chosen in the form
//
// Deploy:  supabase functions deploy create-user
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

    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '').trim()

    if (!token) {
      return json({ error: 'Missing authorization token.' }, 401)
    }

    // Verify the CALLER's session token is valid (not expired/forged).
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } }
    })
    const { data: userData, error: userError } = await callerClient.auth.getUser(token)

    if (userError || !userData?.user) {
      // Same message the app currently surfaces — confirms this is the
      // function the client was hitting when the access token had gone
      // stale (see AuthContext/UserFormModal fix: the client now refreshes
      // the session right before calling this function).
      return json({ error: 'Invalid or expired session. Please refresh the page and try again.' }, 401)
    }

    // Service-role client — bypasses RLS, needed to check the caller's
    // role and to create the new auth user.
    const adminClient = createClient(supabaseUrl, serviceRoleKey)

    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single()

    if (profileError || callerProfile?.role !== 'admin') {
      return json({ error: 'Only Admins can create new users.' }, 403)
    }

    const { email, password, full_name, role } = await req.json()

    if (!email || !password || !full_name || !role) {
      return json({ error: 'Email, password, full name and role are all required.' }, 400)
    }
    if (String(password).length < 6) {
      return json({ error: 'Password must be at least 6 characters.' }, 400)
    }
    const validRoles = ['admin', 'subadmin', 'sales', 'bde', 'calling']
    if (!validRoles.includes(role)) {
      return json({ error: 'Invalid role.' }, 400)
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, role }
    })

    if (createError || !created?.user) {
      return json({ error: createError?.message || 'Could not create the user.' }, 400)
    }

    // handle_new_user() already inserted a profiles row with the correct
    // full_name, but its role is hard-coded to 'bde' — fix it here.
    const { error: updateError } = await adminClient
      .from('profiles')
      .update({ role })
      .eq('id', created.user.id)

    if (updateError) {
      return json({ error: 'User was created, but setting their role failed: ' + updateError.message }, 500)
    }

    return json({ success: true, user_id: created.user.id })
  } catch (err) {
    return json({ error: (err as Error)?.message || 'Unexpected server error.' }, 500)
  }
})
