-- MyResilience-Overclock Complete Database Schema
-- Run this ENTIRE script in Supabase SQL Editor → New Query → Run

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════════
-- USERS & AUTHENTICATION
-- ═══════════════════════════════════════════════════════════════════════════════

-- User profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    email TEXT NOT NULL,
    avatar_url TEXT,
    -- Location for personalized alerts
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    location_name TEXT DEFAULT 'Petaling',
    state TEXT,
    district TEXT,
    -- Preferences
    language TEXT DEFAULT 'en' CHECK (language IN ('en', 'ms', 'zh', 'ta')),
    notification_email BOOLEAN DEFAULT true,
    notification_sms BOOLEAN DEFAULT false,
    notification_push BOOLEAN DEFAULT true,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FAMILY & DEPENDENTS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dependents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    relationship TEXT NOT NULL CHECK (relationship IN (
        'spouse', 'child', 'parent', 'sibling', 'grandparent',
        'grandchild', 'relative', 'caregiver', 'other'
    )),
    age INTEGER,
    age_group TEXT CHECK (age_group IN ('infant', 'toddler', 'child', 'teen', 'adult', 'elderly')),
    -- Special needs for personalized planning
    medical_conditions TEXT[],
    medications TEXT[],
    mobility_level TEXT DEFAULT 'full' CHECK (mobility_level IN ('full', 'limited', 'wheelchair', 'bedridden')),
    dietary_restrictions TEXT[],
    -- Emergency contact priority (1 = highest)
    priority INTEGER DEFAULT 1,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVENTORY MANAGEMENT
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN (
        'water', 'food', 'medical', 'tools', 'documents',
        'clothing', 'communication', 'lighting', 'sanitation', 'other'
    )),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit TEXT DEFAULT 'pcs',
    expiry_date DATE,
    min_quantity INTEGER DEFAULT 1,
    location TEXT DEFAULT 'Home',
    notes TEXT,
    -- Auto-calculated by Guardian agent
    health_score DOUBLE PRECISION DEFAULT 100.0,
    last_checked TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- ALERT HISTORY
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.alert_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'weather', 'flood', 'earthquake', 'tsunami', 'fire',
        'landslide', 'storm', 'haze', 'health', 'security', 'other'
    )),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'emergency')),
    title TEXT NOT NULL,
    description TEXT,
    source TEXT,
    -- Geographic scope
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    radius_km DOUBLE PRECISION,
    affected_areas TEXT[],
    -- Delivery tracking
    delivered_email BOOLEAN DEFAULT false,
    delivered_sms BOOLEAN DEFAULT false,
    delivered_push BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EVACUATION PLANS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.evacuation_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Primary Evacuation Plan',
    -- Route details
    origin_lat DOUBLE PRECISION,
    origin_lng DOUBLE PRECISION,
    destination_name TEXT,
    destination_lat DOUBLE PRECISION,
    destination_lng DOUBLE PRECISION,
    route_notes TEXT,
    -- Assembly point
    assembly_point_name TEXT,
    assembly_lat DOUBLE PRECISION,
    assembly_lng DOUBLE PRECISION,
    -- Transport
    transport_mode TEXT DEFAULT 'car' CHECK (transport_mode IN ('car', 'motorcycle', 'walk', 'bicycle', 'public_transport')),
    estimated_time_minutes INTEGER,
    -- Checklist
    checklist JSONB DEFAULT '[]',
    is_primary BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AGENT DECISION LOG (persistent across serverless invocations)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.agent_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent TEXT NOT NULL,
    event_type TEXT NOT NULL,
    severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'emergency')),
    payload JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent TEXT NOT NULL,
    decision_key TEXT NOT NULL,
    decision JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.escalation_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'critical', 'emergency')),
    action TEXT NOT NULL,
    context JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT LOG
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT,
    ip_address TEXT,
    user_agent TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING SCHEDULES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    briefing_type TEXT NOT NULL CHECK (briefing_type IN ('morning', 'evening', 'emergency', 'on_demand')),
    cron_expression TEXT NOT NULL,
    timezone TEXT DEFAULT 'Asia/Kuala_Lumpur',
    is_active BOOLEAN DEFAULT true,
    agents_required TEXT[] DEFAULT '{sentinel,guardian,escalator}',
    timeout_seconds INTEGER DEFAULT 30,
    max_retries INTEGER DEFAULT 3,
    retry_delays INTEGER[] DEFAULT '{5,15,45}',
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
-- BRIEFING SESSIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID REFERENCES public.briefing_schedules(id) ON DELETE SET NULL,
    briefing_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'health_check', 'refreshing_data', 'running_agents',
        'generating', 'streaming', 'completed', 'failed', 'partial'
    )),
    started_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    agent_results JSONB DEFAULT '{}',
    agents_succeeded TEXT[] DEFAULT '{}',
    agents_failed TEXT[] DEFAULT '{}',
    agents_skipped TEXT[] DEFAULT '{}',
    briefing_content JSONB,
    briefing_text TEXT,
    health_check_results JSONB DEFAULT '{}',
    deployment_commit TEXT,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING FAILURES
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_failures (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID REFERENCES public.briefing_sessions(id) ON DELETE CASCADE,
    agent_name TEXT NOT NULL,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    error_type TEXT NOT NULL,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    request_payload JSONB,
    response_body JSONB,
    started_at TIMESTAMPTZ NOT NULL,
    failed_at TIMESTAMPTZ DEFAULT now(),
    duration_ms INTEGER,
    retry_after_seconds INTEGER,
    will_retry BOOLEAN DEFAULT true,
    max_retries INTEGER DEFAULT 3,
    alert_sent BOOLEAN DEFAULT false,
    alert_sent_at TIMESTAMPTZ,
    alert_channel TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIEFING SUBSCRIPTIONS
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.briefing_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    schedule_id UUID REFERENCES public.briefing_schedules(id) ON DELETE CASCADE,
    delivery_channel TEXT DEFAULT 'in_app' CHECK (delivery_channel IN ('in_app', 'email', 'sms', 'push', 'all')),
    preferred_language TEXT DEFAULT 'en' CHECK (preferred_language IN ('en', 'ms', 'zh', 'ta')),
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
    overall_status TEXT NOT NULL CHECK (overall_status IN ('healthy', 'degraded', 'unhealthy')),
    endpoints_checked INTEGER DEFAULT 0,
    endpoints_healthy INTEGER DEFAULT 0,
    endpoints_failed INTEGER DEFAULT 0,
    endpoint_results JSONB DEFAULT '{}',
    database_status TEXT,
    cache_status TEXT,
    commit_hash TEXT,
    deployment_url TEXT,
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

CREATE INDEX IF NOT EXISTS idx_dependents_user ON public.dependents(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON public.inventory_items(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON public.inventory_items(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_user ON public.alert_history(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON public.alert_history(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON public.alert_history(alert_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evacuation_user ON public.evacuation_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON public.agent_events(agent, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_type ON public.agent_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON public.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON public.audit_log(action, created_at DESC);
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
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dependents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evacuation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.briefing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sse_connections ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only read/update their own
CREATE POLICY "Users can view own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Dependents: users can CRUD their own dependents
CREATE POLICY "Users can manage own dependents" ON public.dependents
    FOR ALL USING (auth.uid() = user_id);

-- Inventory: users can CRUD their own inventory
CREATE POLICY "Users can manage own inventory" ON public.inventory_items
    FOR ALL USING (auth.uid() = user_id);

-- Alerts: users can read alerts addressed to them or global alerts
CREATE POLICY "Users can view own alerts" ON public.alert_history
    FOR SELECT USING (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "System can insert alerts" ON public.alert_history
    FOR INSERT WITH CHECK (true);

-- Evacuation plans: users can CRUD their own
CREATE POLICY "Users can manage own evacuation plans" ON public.evacuation_plans
    FOR ALL USING (auth.uid() = user_id);

-- Audit log: users can view their own, system can insert
CREATE POLICY "Users can view own audit log" ON public.audit_log
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "System can insert audit log" ON public.audit_log
    FOR INSERT WITH CHECK (true);

-- Briefing tables
CREATE POLICY "briefing_schedules_read" ON public.briefing_schedules
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "briefing_sessions_read" ON public.briefing_sessions
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "briefing_failures_read" ON public.briefing_failures
    FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "briefing_subscriptions_own" ON public.briefing_subscriptions
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "deployment_health_read" ON public.deployment_health
    FOR SELECT USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER dependents_updated_at
    BEFORE UPDATE ON public.dependents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER inventory_updated_at
    BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER evacuation_updated_at
    BEFORE UPDATE ON public.evacuation_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NEW.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();
