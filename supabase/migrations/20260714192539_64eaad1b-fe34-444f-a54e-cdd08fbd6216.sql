
CREATE TABLE public.days (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  day_date DATE NOT NULL,
  tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, day_date)
);

CREATE INDEX days_user_date_idx ON public.days(user_id, day_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.days TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.days TO authenticated;
GRANT ALL ON public.days TO service_role;

ALTER TABLE public.days ENABLE ROW LEVEL SECURITY;

-- Anonymous app: the anon key is the only client-side identity.
-- Permissive policy is intentional; a real login can later scope by auth.uid().
CREATE POLICY "Anyone can read days" ON public.days FOR SELECT USING (true);
CREATE POLICY "Anyone can insert days" ON public.days FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update days" ON public.days FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can delete days" ON public.days FOR DELETE USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_days_updated_at
BEFORE UPDATE ON public.days
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
