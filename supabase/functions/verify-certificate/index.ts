import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Map internal errors to user-friendly messages
function getUserMessage(error: Error): string {
  const errorMap: Record<string, string> = {
    'Missing certificate number': 'Invalid verification request. Please provide a certificate number.',
  };
  
  return errorMap[error.message] || 'An unexpected error occurred during verification. Please contact support if the issue persists.';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { certificateNumber } = await req.json();

    if (!certificateNumber) {
      throw new Error('Missing certificate number');
    }

    // Get certificate only (avoid relying on FK-based nested selects)
    const { data: cert, error: certError } = await supabase
      .from('certificates')
      .select('*')
      .eq('certificate_number', certificateNumber)
      .maybeSingle();

    if (certError) {
      console.error('Error fetching certificate:', certError);
      throw certError;
    }

    if (!cert) {
      return new Response(
        JSON.stringify({ success: true, certificate: null, valid: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch related info separately (no FK dependency)
    const [{ data: profile }, { data: course }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', cert.user_id).maybeSingle(),
      supabase.from('courses').select('title').eq('id', cert.course_id).maybeSingle(),
    ]);

    const responseCert = {
      ...cert,
      profiles: profile || null,
      courses: course || null,
    };

    return new Response(
      JSON.stringify({ success: true, certificate: responseCert, valid: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    // Log detailed error server-side only
    console.error('Certificate verification error:', error);
    
    // Return user-friendly message to client
    const userMessage = error instanceof Error 
      ? getUserMessage(error) 
      : 'An unexpected error occurred during verification. Please contact support if the issue persists.';
    
    return new Response(
      JSON.stringify({ error: userMessage, valid: false }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});