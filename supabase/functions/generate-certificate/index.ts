import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const certificateRequestSchema = z.object({
  courseId: z.string().uuid('Invalid course ID format')
});

// Map internal errors to user-friendly messages
function getUserMessage(error: Error): string {
  const errorMap: Record<string, string> = {
    'Missing authorization header': 'Authentication required. Please log in.',
    'Unauthorized': 'Authentication required. Please log in.',
    'Missing course ID': 'Invalid request. Please try again.',
    'Course not found': 'The selected course does not exist.',
    'Enrollment not found': 'Unable to generate certificate. Please ensure you are enrolled in this course.',
    'Course not completed yet': 'Certificate requires 100% course completion. Please finish all course materials.',
    'Failed to create certificate': 'Certificate generation is temporarily unavailable. Please try again later.',
  };
  
  return errorMap[error.message] || 'An unexpected error occurred. Please contact support if the issue persists.';
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

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    // Parse and validate request body
    const requestBody = await req.json();
    const validationResult = certificateRequestSchema.safeParse(requestBody);
    
    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors[0]?.message || 'Invalid input';
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { courseId } = validationResult.data;

    // Verify course exists
    const { data: courseCheck, error: courseCheckError } = await supabase
      .from('courses')
      .select('id')
      .eq('id', courseId)
      .single();

    if (courseCheckError || !courseCheck) {
      throw new Error('Course not found');
    }

    // Check if enrollment is complete
    const { data: enrollment, error: enrollError } = await supabase
      .from('enrollments')
      .select('progress, completed_at')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .single();

    if (enrollError || !enrollment) {
      throw new Error('Enrollment not found');
    }

    if (enrollment.progress < 100) {
      throw new Error('Course not completed yet');
    }

    // Check if certificate already exists
    const { data: existingCert } = await supabase
      .from('certificates')
      .select('*')
      .eq('user_id', user.id)
      .eq('course_id', courseId)
      .maybeSingle();

    if (existingCert) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          certificate: existingCert,
          message: 'Certificate already exists'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate certificate number
    const { data: certNumber } = await supabase.rpc('generate_certificate_number');

    // Get course and user details
    const { data: course } = await supabase
      .from('courses')
      .select('title')
      .eq('id', courseId)
      .single();

    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    // Create verification URL - users will scan QR and go to this page
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const projectId = supabaseUrl.split('//')[1]?.split('.')[0] ?? '';
    const verificationUrl = `https://${projectId}.lovable.app/certificate/verify/${certNumber}`;
    
    // Generate QR code URL using a public QR code API - QR code will directly link to verification page
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(verificationUrl)}`;

    // Create certificate record
    const { data: certificate, error: certError } = await supabase
      .from('certificates')
      .insert({
        user_id: user.id,
        course_id: courseId,
        certificate_number: certNumber,
        qr_code_url: qrCodeUrl
      })
      .select()
      .single();

    if (certError) {
      console.error('Certificate creation error:', certError);
      throw new Error('Failed to create certificate');
    }

    console.log('Certificate generated successfully:', {
      certificate_number: certNumber,
      user: profile?.full_name,
      course: course?.title,
      verification_url: verificationUrl
    });

    return new Response(
      JSON.stringify({
        success: true,
        certificate: {
          ...certificate,
          course_title: course?.title,
          user_name: profile?.full_name,
          verification_url: verificationUrl
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Log detailed error server-side only
    console.error('Certificate generation error:', error);
    
    // Return user-friendly message to client
    const userMessage = error instanceof Error 
      ? getUserMessage(error) 
      : 'An unexpected error occurred. Please contact support if the issue persists.';
    
    return new Response(
      JSON.stringify({ error: userMessage }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
