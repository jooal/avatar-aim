-- Hangout Sessions Table
-- Run this in your Supabase SQL Editor

CREATE TABLE hangout_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  avatar_x FLOAT DEFAULT 100,
  avatar_y FLOAT DEFAULT 100,
  avatar_type TEXT DEFAULT 'default',
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(conversation_id, user_id)
);

-- Index for fast lookups
CREATE INDEX idx_hangout_sessions_conversation ON hangout_sessions(conversation_id);

-- Enable RLS
ALTER TABLE hangout_sessions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view hangout sessions in their conversations" ON hangout_sessions
  FOR SELECT TO authenticated
  USING (
    conversation_id IN (
      SELECT conversation_id FROM conversation_participants WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can join hangouts" ON hangout_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own hangout" ON hangout_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can leave hangouts" ON hangout_sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Enable realtime for hangout sessions
ALTER PUBLICATION supabase_realtime ADD TABLE hangout_sessions;
