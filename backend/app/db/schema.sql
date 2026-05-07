-- MyResilience-Overclock Database Schema
-- Run this in Supabase SQL Editor to initialize the database

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

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dependents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evacuation_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

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

-- Agent tables: service role only (no RLS for agent_events, agent_decisions, escalation_log)
-- These are managed by the backend service role, not user-facing

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS
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
