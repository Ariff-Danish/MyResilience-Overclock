-- MyResilience Automated Briefing System Schema
-- Run this in Supabase SQL Editor after the main schema.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING SCHEDULES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    briefing_type TEXT NOT NULL CHECK (briefing_type IN ('morning', 'evening', 'emergency', 'on_demand')),
    cron_expression TEXT NOT NULL,  -- e.g. '0 0 * * *' (UTC) for 8 AM MYT
    timezone TEXT DEFAULT 'Asia/Kuala_Lumpur',
    is_active BOOLEAN DEFAULT true,
    -- Configuration
    agents_required TEXT[] DEFAULT '{sentinel,guardian,escalator}',
    timeout_seconds INTEGER DEFAULT 30,
    max_retries INTEGER DEFAULT 3,
    retry_delays INTEGER[] DEFAULT '{5,15,45}',
    -- Metadata
    last_run_at TIMESTAMPTZ,
    last_status TEXT,
    next_run_at TIMESTAMPTZ,
    run_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Default schedules
INSERT INTO public.briefing_schedules (name, briefing_type, cron_expression, agents_required)
VALUES
    ('Morning Briefing', 'morning', '0 0 * * *', '{sentinel,guardian,escalator}'),
    ('Evening Briefing', 'evening', '0 12 * * *', '{sentinel,guardian,escalator}')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING SESSIONS (execution records)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID REFERENCES public.briefing_schedules(id) ON DELETE SET NULL,
    briefing_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'health_check', 'refreshing_data', 'running_agents',
        'generating', 'streaming', 'completed', 'failed', 'partial'
    )),
    -- Execution details
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    -- Agent results
    agent_results JSONB DEFAULT '{}',
    agents_succeeded TEXT[] DEFAULT '{}',
    agents_failed TEXT[] DEFAULT '{}',
    agents_skipped TEXT[] DEFAULT '{}',
    -- Briefing content
    briefing_content JSONB,
    briefing_text TEXT,
    -- Health check results
    health_check_results JSONB DEFAULT '{}',
    deployment_commit TEXT,
    -- Error tracking
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING FAILURES (detailed failure logs)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_failures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    -- Failure details
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    request_payload JSONB,
    response_body JSONB,
    -- Timing
    started_at TIMESTAMPTZ NOT NULL,
    failed_at TIMESTAMPTZ DEFAULT now(),
    duration_ms INTEGER,
    -- Retry info
    retry_after_seconds INTEGER,
    will_retry BOOLEAN DEFAULT true,
    max_retries INTEGER DEFAULT 3,
    -- Alert tracking
    alert_sent BOOLEAN DEFAULT false,
    alert_sent_at TIMESTAMPTZ,
    alert_channel TEXT,  -- email, sms, push
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING SUBSCRIPTIONS (user preferences)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES public.briefing_schedules(id) ON DELETE CASCADE,
    -- Delivery preferences
    delivery_channel TEXT DEFAULT 'in_app' CHECK (delivery_channel IN ('in_app', 'email', 'sms', 'push', 'all')),
    preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en', 'ms', 'zh', 'ta')),
    -- Status
    is_active BOOLEAN DEFAULT true,
    last_delivered_at TIMESTAMPTZ,
    delivery_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, schedule_id)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- DEPLOYMENT HEALTH LOG
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.deployment_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    check_type TEXT NOT NULL CHECK (check_type IN ('pre_briefing', 'scheduled', 'manual')),
    -- Results
    overall_status TEXT NOT NULL CHECK (overall_status IN ('healthy', 'degraded', 'unhealthy')),
    endpoints_checked INTEGER DEFAULT 0,
    endpoints_healthy INTEGER DEFAULT 0,
    endpoints_failed INTEGER DEFAULT 0,
    -- Details
    endpoint_results JSONB DEFAULT '{}',
    database_status TEXT,
    cache_status TEXT,
    commit_hash TEXT,
    deployment_url TEXT,
    -- Timing
    checked_at TIMESTAMPTZ DEFAULT now(),
    duration_ms INTEGER
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SSE CONNECTION TRACKING
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sse_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    session_id UUID REFERENCES public.briefing_sessions(id) ON DELETE SET NULL,
    connected_at TIMESTAMPTZ DEFAULT now(),
    disconnected_at TIMESTAMPTZ,
    events_sent INTEGER DEFAULT 0,
    client_info JSONB DEFAULT '{}'
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_briefing_sessions_schedule ON public.briefing_sessions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_briefing_sessions_status ON public.briefing_sessions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_sessions_type ON public.briefing_sessions(briefing_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_failures_session ON public.briefing_failures(session_id);
CREATE INDEX IF NOT EXISTS idx_briefing_failures_agent ON public.briefing_failures(agent_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_briefing_subscriptions_user ON public.briefing_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_briefing_subscriptions_schedule ON public.briefing_subscriptions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_deployment_health_checked ON public.deployment_health(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_sse_connections_session ON public.sse_connections(session_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.briefing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sse_connections ENABLE ROW LEVEL SECURITY;

-- Schedules: read for all authenticated, write for service role
CREATE POLICY "briefing_schedules_read" ON public.briefing_schedules
    FOR SELECT USING (auth.role() = 'authenticated');

-- Sessions: read for all authenticated
CREATE POLICY "briefing_sessions_read" ON public.briefing_sessions
    FOR SELECT USING (auth.role() = 'authenticated');

-- Failures: read for all authenticated
CREATE POLICY "briefing_failures_read" ON public.briefing_failures
    FOR SELECT USING (auth.role() = 'authenticated');

-- Subscriptions: users can manage their own
CREATE POLICY "briefing_subscriptions_own" ON public.briefing_subscriptions
    FOR ALL USING (auth.uid() = user_id);

-- Health: read for all authenticated
CREATE POLICY "deployment_health_read" ON public.deployment_health
    FOR SELECT USING (auth.role() = 'authenticated');

-- SSE: users can see their own connections
CREATE POLICY "sse_connections_own" ON public.sse_connections
    FOR SELECT USING (auth.uid() = user_id);
