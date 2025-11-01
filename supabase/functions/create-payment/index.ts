import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Input validation schema
const paymentRequestSchema = z.object({
  courseId: z.string().uuid('Invalid course ID format'),
  amount: z.number().positive('Amount must be positive').min(1, 'Amount must be at least 1')
});

// Map internal errors to user-friendly messages
function getUserMessage(error: Error): string {
  const errorMap: Record<string, string> = {
    'Missing authorization header': 'Authentication required. Please log in.',
    'Unauthorized': 'Authentication required. Please log in.',
    'Missing required fields': 'Invalid payment request. Please try again.',
    'Course not found': 'The selected course does not exist or is not available.',
    'Price mismatch': 'The payment amount does not match the course price.',
    'Failed to create payment record': 'Payment processing is temporarily unavailable. Please try again later.',
    'Failed to create Midtrans transaction': 'Payment provider is temporarily unavailable. Please try again later.',
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
    const validationResult = paymentRequestSchema.safeParse(requestBody);
    
    if (!validationResult.success) {
      const errorMessage = validationResult.error.errors[0]?.message || 'Invalid input';
      console.error('Validation error:', validationResult.error);
      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { courseId, amount } = validationResult.data;

    // Verify course exists and validate price
    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('id, price, is_free, status')
      .eq('id', courseId)
      .single();

    if (courseError || !course) {
      throw new Error('Course not found');
    }

    // Validate amount matches course price (unless course is free)
    if (!course.is_free && course.price !== amount) {
      throw new Error('Price mismatch');
    }

    // Generate unique order ID
    const orderId = `ORDER-${Date.now()}-${user.id.substring(0, 8)}`;

    // Create payment record in database
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .insert({
        user_id: user.id,
        course_id: courseId,
        amount: amount,
        midtrans_order_id: orderId,
        status: 'pending'
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Payment creation error:', paymentError);
      throw new Error('Failed to create payment record');
    }

    // Get user profile for transaction details
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();

    // Create Midtrans transaction
    const serverKey = Deno.env.get('MIDTRANS_SERVER_KEY');
    const isProduction = Deno.env.get('MIDTRANS_IS_PRODUCTION') === 'true';
    const midtransUrl = isProduction 
      ? 'https://api.midtrans.com/v2/charge'
      : 'https://api.sandbox.midtrans.com/v2/charge';

    const midtransPayload = {
      payment_type: 'gopay',
      transaction_details: {
        order_id: orderId,
        gross_amount: amount
      },
      customer_details: {
        first_name: profile?.full_name || 'User',
        email: user.email
      }
    };

    const midtransResponse = await fetch(midtransUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Basic ${btoa(serverKey + ':')}`
      },
      body: JSON.stringify(midtransPayload)
    });

    const midtransData = await midtransResponse.json();

    if (!midtransResponse.ok) {
      console.error('Midtrans error:', midtransData);
      throw new Error('Failed to create Midtrans transaction');
    }

    // Update payment with transaction ID
    await supabase
      .from('payments')
      .update({
        midtrans_transaction_id: midtransData.transaction_id,
        payment_type: midtransData.payment_type
      })
      .eq('id', payment.id);

    return new Response(
      JSON.stringify({
        success: true,
        payment_url: midtransData.actions?.find((a: any) => a.name === 'generate-qr-code')?.url || midtransData.redirect_url,
        order_id: orderId,
        transaction_id: midtransData.transaction_id
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Log detailed error server-side only
    console.error('Payment creation error:', error);
    
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
