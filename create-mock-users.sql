-- Create 3 mock users for testing
-- Run this in your Supabase SQL Editor

-- User 1: RetroGamer99
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role
) VALUES (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'retrogamer99@example.com',
  crypt('password123', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"screen_name": "RetroGamer99"}',
  'authenticated', 'authenticated'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, screen_name, email, status)
VALUES ('11111111-1111-1111-1111-111111111111', 'RetroGamer99', 'retrogamer99@example.com', 'online')
ON CONFLICT (id) DO UPDATE SET status = 'online';

-- User 2: PixelQueen
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role
) VALUES (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'pixelqueen@example.com',
  crypt('password123', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"screen_name": "PixelQueen"}',
  'authenticated', 'authenticated'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, screen_name, email, status)
VALUES ('22222222-2222-2222-2222-222222222222', 'PixelQueen', 'pixelqueen@example.com', 'away')
ON CONFLICT (id) DO UPDATE SET status = 'away', away_message = 'Playing video games brb!';

-- User 3: CyberDude2000
INSERT INTO auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role
) VALUES (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'cyberdude2000@example.com',
  crypt('password123', gen_salt('bf')),
  NOW(), NOW(), NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"screen_name": "CyberDude2000"}',
  'authenticated', 'authenticated'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, screen_name, email, status)
VALUES ('33333333-3333-3333-3333-333333333333', 'CyberDude2000', 'cyberdude2000@example.com', 'offline')
ON CONFLICT (id) DO UPDATE SET status = 'offline';

-- To add these users as friends, first find your user ID:
-- SELECT id, screen_name FROM profiles;

-- Then run these (replace YOUR_USER_ID with your actual ID):
-- INSERT INTO friends (user_id, friend_id, status) VALUES ('YOUR_USER_ID', '11111111-1111-1111-1111-111111111111', 'accepted');
-- INSERT INTO friends (user_id, friend_id, status) VALUES ('YOUR_USER_ID', '22222222-2222-2222-2222-222222222222', 'accepted');
-- INSERT INTO friends (user_id, friend_id, status) VALUES ('YOUR_USER_ID', '33333333-3333-3333-3333-333333333333', 'accepted');
