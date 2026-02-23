-- Create a test user for chatting
-- Run this in your Supabase SQL Editor

-- First, create a test auth user
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role
) VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  '00000000-0000-0000-0000-000000000000',
  'testfriend@example.com',
  crypt('password123', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"screen_name": "TestBuddy"}',
  'authenticated',
  'authenticated'
) ON CONFLICT (id) DO NOTHING;

-- Create the profile for the test user
INSERT INTO profiles (id, screen_name, email, status)
VALUES (
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'TestBuddy',
  'testfriend@example.com',
  'online'
) ON CONFLICT (id) DO UPDATE SET status = 'online';

-- Now create the friendship (you need to replace YOUR_USER_ID with your actual user ID)
-- To find your user ID, run: SELECT id, screen_name FROM profiles;

-- After finding your ID, run this (replace the UUID):
-- INSERT INTO friends (user_id, friend_id, status)
-- VALUES ('YOUR_USER_ID_HERE', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'accepted');
