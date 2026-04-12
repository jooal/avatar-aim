import React, { useState, useEffect, useRef } from 'react';
import { supabase, Profile } from './lib/supabase';
import { User, RealtimeChannel } from '@supabase/supabase-js';
import { playSignOnSound, playSignOffSound, playMessageSound } from './utils/sounds';

// Convert plain-text URLs into clickable <a> tags
function linkifyUrls(html: string): string {
  // Match URLs that aren't already inside an href attribute or <a> tag
  return html.replace(
    /(?<!["'=])\b(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
}

// Sanitize HTML to prevent XSS while allowing formatting tags
function sanitizeHtml(html: string): string {
  // If it doesn't contain HTML tags, return as-is (plain text message)
  // but still linkify URLs
  if (!/<[^>]+>/.test(html)) {
    return linkifyUrls(html);
  }

  const safeTags = ['b', 'strong', 'i', 'em', 'u', 'span', 'font', 'br', 'div', 'p', 'a'];
  const safeAttrs = ['color', 'size', 'face', 'style', 'href', 'target', 'rel']; // Allow font + style + link attrs

  // Use DOMParser to avoid executing scripts during parsing
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Walk through all elements and sanitize
  const allElements = Array.from(doc.body.querySelectorAll('*'));
  for (const el of allElements) {
    if (!safeTags.includes(el.tagName.toLowerCase())) {
      // Replace unsafe element with its text content
      const text = doc.createTextNode(el.textContent || '');
      el.parentNode?.replaceChild(text, el);
      continue;
    }

    // Remove all attributes except safe ones
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (!safeAttrs.includes(attr.name)) {
        el.removeAttribute(attr.name);
      }
    }

    // Sanitize href to only allow http/https (block javascript: etc)
    if (el.tagName.toLowerCase() === 'a' && el.hasAttribute('href')) {
      const href = el.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) {
        el.removeAttribute('href');
      }
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }

    // Sanitize style attribute to only allow background-color
    if (el.hasAttribute('style')) {
      const bgMatch = el.getAttribute('style')?.match(/background-color\s*:\s*([^;\"']+)/);
      if (bgMatch) {
        el.setAttribute('style', `background-color: ${bgMatch[1].trim()}`);
      } else {
        el.removeAttribute('style');
      }
    }
  }

  // Linkify any plain-text URLs that aren't already in <a> tags
  return linkifyUrls(doc.body.innerHTML);
}

// Process special characters in away messages
function processAwayMessageSpecialChars(message: string, buddyName?: string): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return message
    .replace(/%n/g, buddyName || 'Buddy')
    .replace(/%d/g, dateStr)
    .replace(/%t/g, timeStr);
}

type Status = 'online' | 'away' | 'offline';

// Avatar options for user selection
const AVATAR_OPTIONS = ['👾', '😎', '🐱', '🤖', '🦊', '👻'];

interface Friend {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted' | 'blocked';
  created_at: string;
  profile?: Profile;
}

interface Conversation {
  id: string;
  name: string | null;
  is_group: boolean;
  created_at: string;
  participants?: Profile[];
  last_message?: Message;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender?: Profile;
}

interface HangoutSession {
  id: string;
  conversation_id: string;
  user_id: string;
  avatar_x: number;
  avatar_y: number;
  avatar_type: string;
  joined_at: string;
  profile?: Profile;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'login' | 'signup' | 'reset'>('login');

  // Check if this is a chat window route
  const hash = window.location.hash;
  const chatMatch = hash.match(/^#\/chat\/(.+)$/);
  const conversationId = chatMatch ? chatMatch[1] : null;

  console.log('App render - hash:', hash, 'conversationId:', conversationId, 'user:', !!user, 'loading:', loading);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        loadProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(userId: string) {
    // Retry a few times in case the DB trigger hasn't created the profile yet
    let data = null;
    for (let i = 0; i < 5; i++) {
      const result = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      data = result.data;
      if (data) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // If profile still doesn't exist, create it from auth metadata
    if (!data) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const screenName = user.user_metadata?.screen_name || user.email?.split('@')[0] || 'User';
        const { data: newProfile } = await supabase
          .from('profiles')
          .upsert({ id: userId, screen_name: screenName, email: user.email || '' })
          .select()
          .single();
        data = newProfile;
      }
    }

    setProfile(data);
    setLoading(false);

    // Only set online if currently offline (don't override manual away status)
    if (data && data.status === 'offline') {
      await supabase
        .from('profiles')
        .update({ status: 'online' })
        .eq('id', userId);
    }
  }

  async function handleLogout() {
    // Set offline before logging out
    if (user) {
      await supabase
        .from('profiles')
        .update({ status: 'offline' })
        .eq('id', user.id);
    }
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-win-gray flex items-center justify-center">
        <div className="text-gray-700">Loading...</div>
      </div>
    );
  }

  // If this is a chat window, render the ChatWindow component
  if (conversationId && user) {
    return <ChatWindow conversationId={conversationId} user={user} profile={profile} />;
  }

  return (
    <div className="min-h-screen bg-win-gray">
      {!user ? (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="w-full max-w-xs">
            {/* AIM Sign On Window */}
            <div className="win-raised bg-win-gray">
              {/* Title bar */}
              <div className="win-titlebar">
                <span className="text-sm">Sign On</span>
              </div>

              <div className="p-5 pt-4">
                {/* AIM Logo Area */}
                <div className="text-center mb-4">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-aim-yellow mb-2">
                    <span className="text-3xl">😎</span>
                  </div>
                  <h1 className="text-lg font-bold text-gray-800">Avatar AIM</h1>
                </div>

                {view === 'login' ? (
                  <LoginForm onSwitch={() => setView('signup')} onReset={() => setView('reset')} />
                ) : view === 'signup' ? (
                  <SignupForm onSwitch={() => setView('login')} />
                ) : (
                  <ResetPasswordForm onSwitch={() => setView('login')} />
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <BuddyList user={user} profile={profile} onLogout={handleLogout} setProfile={setProfile} />
      )}
    </div>
  );
}

function LoginForm({ onSwitch, onReset }: { onSwitch: () => void; onReset: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
    }
    setLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="p-2 bg-red-100 border border-red-400 text-red-700 text-xs">
          {error}
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="win-input w-full py-1"
          placeholder="Enter your email"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-gray-700 mb-1">Password</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="win-input w-full py-1 pr-8"
            placeholder="Password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-800 px-1"
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="save-pw" className="accent-aim-yellow" />
        <label htmlFor="save-pw" className="text-xs text-gray-600">Save password</label>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="win-button w-full py-1.5 font-bold disabled:opacity-50"
      >
        {loading ? 'Signing On...' : 'Sign On'}
      </button>
      <div className="flex justify-between text-xs text-gray-600">
        <button type="button" onClick={onReset} className="text-[#0000FF] hover:underline">
          Forgot password?
        </button>
        <button type="button" onClick={onSwitch} className="text-[#0000FF] hover:underline">
          Get a Screen Name
        </button>
      </div>
    </form>
  );
}

function ResetPasswordForm({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'https://landing-eight-peach.vercel.app/reset-password.html',
    });

    if (error) {
      setError(error.message);
    } else {
      setSuccess(true);
    }
    setLoading(false);
  };

  if (success) {
    return (
      <div className="space-y-3">
        <div className="p-2 bg-green-100 border border-green-400 text-green-700 text-xs">
          Check your email for a password reset link.
        </div>
        <button
          type="button"
          onClick={onSwitch}
          className="win-button w-full py-1.5 font-bold"
        >
          Back to Sign On
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="p-2 bg-red-100 border border-red-400 text-red-700 text-xs">
          {error}
        </div>
      )}
      <p className="text-xs text-gray-600">Enter your email and we'll send you a link to reset your password.</p>
      <div>
        <label className="block text-xs text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="win-input w-full py-1"
          placeholder="Enter your email"
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="win-button w-full py-1.5 font-bold disabled:opacity-50"
      >
        {loading ? 'Sending...' : 'Reset Password'}
      </button>
      <p className="text-center text-xs text-gray-600">
        <button type="button" onClick={onSwitch} className="text-[#0000FF] hover:underline">
          Back to Sign On
        </button>
      </p>
    </form>
  );
}

function SignupForm({ onSwitch }: { onSwitch: () => void }) {
  const [screenName, setScreenName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validatePassword = (pw: string) => {
    if (pw.length < 8) return 'Password must be at least 8 characters';
    if (!/\d/.test(pw)) return 'Password must contain at least 1 number';
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(pw)) return 'Password must contain at least 1 symbol';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError('Please enter a valid email address');
      return;
    }

    const pwError = validatePassword(password);
    if (pwError) {
      setError(pwError);
      return;
    }

    setLoading(true);

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('screen_name')
      .eq('screen_name', screenName)
      .single();

    if (existingProfile) {
      setError('Screen name is already taken');
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { screen_name: screenName },
        emailRedirectTo: 'https://landing-eight-peach.vercel.app/confirmed.html',
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.user && !error) {
      if (!data.session) {
        setError('Account created! Please check your email to confirm, then sign in.');
        setLoading(false);
        onSwitch();
        return;
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {error && (
        <div className="p-2 bg-red-100 border border-red-400 text-red-700 text-xs">
          {error}
        </div>
      )}
      <div>
        <label className="block text-xs text-gray-700 mb-1">Screen Name</label>
        <input
          type="text"
          value={screenName}
          onChange={(e) => setScreenName(e.target.value)}
          className="win-input w-full py-1"
          placeholder="Choose a screen name"
          required
          minLength={3}
          maxLength={20}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="win-input w-full py-1"
          placeholder="Enter your email"
          required
        />
      </div>
      <div>
        <label className="block text-xs text-gray-700 mb-1">Password</label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="win-input w-full py-1 pr-8"
            placeholder="Password"
            required
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-800 px-1"
          >
            {showPassword ? '🙈' : '👁'}
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-0.5">8+ characters, 1 number, 1 symbol</p>
      </div>
      <button
        type="submit"
        disabled={loading}
        className="win-button w-full py-1.5 font-bold disabled:opacity-50"
      >
        {loading ? 'Creating...' : 'Get a Screen Name'}
      </button>
      <p className="text-center text-xs text-gray-600">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-[#0000FF] hover:underline">
          Sign On
        </button>
      </p>
    </form>
  );
}

// Separate Chat Window Component
function ChatWindow({ conversationId, user, profile: initialProfile }: {
  conversationId: string;
  user: User;
  profile: Profile | null;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [freshProfile, setFreshProfile] = useState<Profile | null>(initialProfile);

  // Fetch fresh profile data and subscribe to changes
  useEffect(() => {
    async function loadFreshProfile() {
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) {
        setFreshProfile(data);
      }
    }
    loadFreshProfile();

    // Subscribe to ALL profile changes so we see when other participants go away/online
    const channel = supabase
      .channel(`profile-changes-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
      }, (payload) => {
        const updatedProfile = payload.new as Profile;
        if (updatedProfile.id === user.id) {
          setFreshProfile(updatedProfile);
        }
        // Update the participant in the conversation state too
        setConversation(prev => {
          if (!prev || !prev.participants) return prev;
          const idx = prev.participants.findIndex(p => p.id === updatedProfile.id);
          if (idx === -1) return prev;
          const newParticipants = [...prev.participants];
          newParticipants[idx] = updatedProfile;
          return { ...prev, participants: newParticipants };
        });
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);

  // Load conversation and messages in parallel
  useEffect(() => {
    loadAllData();
  }, [conversationId]);

  async function loadAllData() {
    setLoading(true);
    setLoadingMessages(true);

    try {
      // Load conversation and messages in parallel
      const [convoResult, messagesResult] = await Promise.all([
        loadConversationData(),
        loadMessagesData()
      ]);

      if (convoResult) {
        setConversation(convoResult);
      }
      setMessages(messagesResult);
    } finally {
      setLoading(false);
      setLoadingMessages(false);
    }
  }

  async function loadConversationData(): Promise<Conversation | null> {
    const { data: convo } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (!convo) return null;

    // Load participants
    const { data: participants } = await supabase
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);

    if (participants) {
      const userIds = participants.map(p => p.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      return { ...convo, participants: profiles || [] };
    }
    return convo;
  }

  async function loadMessagesData(): Promise<Message[]> {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (data && data.length > 0) {
      const senderIds = [...new Set(data.map(m => m.sender_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', senderIds);

      return data.map(m => ({
        ...m,
        sender: profiles?.find(p => p.id === m.sender_id) || null
      }));
    }
    return [];
  }

  // Set window title to conversation name
  useEffect(() => {
    if (!conversation) return;

    // For DMs, show the other participant's name
    if (!conversation.is_group) {
      const otherParticipant = conversation.participants?.find(p => p.id !== user.id);
      if (otherParticipant) {
        document.title = `Instant Message with ${otherParticipant.screen_name || 'Chat'}`;
      } else {
        // Self-chat: show own name
        const selfParticipant = conversation.participants?.find(p => p.id === user.id);
        document.title = `Instant Message with ${selfParticipant?.screen_name || freshProfile?.screen_name || 'Chat'}`;
      }
    } else {
      // For group chats, show the group name
      document.title = conversation.name || 'Group Chat';
    }
  }, [conversation, user.id, freshProfile]);

  useEffect(() => {
    if (!conversation) return;

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, async (payload) => {
        const newMessage = payload.new as Message;
        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', newMessage.sender_id)
          .single();

        setMessages(prev => [...prev, { ...newMessage, sender: senderProfile }]);

        // Play sound for messages from others
        if (newMessage.sender_id !== user.id) {
          playMessageSound();
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation?.id]);

  if (loading) {
    return (
      <div className="h-screen bg-win-gray flex items-center justify-center">
        <div className="text-gray-600 text-xs">Loading chat...</div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="h-screen bg-win-gray flex items-center justify-center">
        <div className="text-gray-600 text-xs">Conversation not found</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-win-gray win-raised">
      <ChatArea
        conversation={conversation}
        messages={messages}
        currentUserId={user.id}
        profile={freshProfile}
        loadingMessages={loadingMessages}
      />
    </div>
  );
}

function BuddyList({ user, profile, onLogout, setProfile }: {
  user: User;
  profile: Profile | null;
  onLogout: () => void;
  setProfile: (p: Profile | null) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Friend[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showMyAimMenu, setShowMyAimMenu] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [viewingProfileId, setViewingProfileId] = useState<string | null>(null);
  const viewingProfile = viewingProfileId
    ? friends.find(f => f.profile?.id === viewingProfileId)?.profile || null
    : null;
  const [showAwayMessage, setShowAwayMessage] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const startingDMRef = useRef(false);
  const [buddiesCollapsed, setBuddiesCollapsed] = useState(false);
  const [offlineCollapsed, setOfflineCollapsed] = useState(false);
  const [groupsCollapsed, setGroupsCollapsed] = useState(false);
  const [recentlySignedOn, setRecentlySignedOn] = useState<Set<string>>(new Set());
  const signOnTimeouts = useRef<Set<NodeJS.Timeout>>(new Set());

  const avatarPickerRef = useRef<HTMLDivElement>(null);
  const myAimMenuRef = useRef<HTMLDivElement>(null);

  // Close avatar picker when clicking outside
  useEffect(() => {
    if (!showAvatarPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (avatarPickerRef.current && !avatarPickerRef.current.contains(e.target as Node)) {
        setShowAvatarPicker(false);
      }
    };
    // Use click (not mousedown) so button onClick fires first
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showAvatarPicker]);

  // Handle app quit — set user offline before quitting
  useEffect(() => {
    const unsubscribe = window.electronAPI?.onBeforeQuit(async () => {
      try {
        await supabase
          .from('profiles')
          .update({ status: 'offline' })
          .eq('id', user.id);
      } catch (e) {
        console.log('Failed to set offline on quit:', e);
      }
      window.electronAPI?.signoffComplete();
    });
    return unsubscribe;
  }, [user.id]);

  // Close My AIM menu when clicking outside
  useEffect(() => {
    if (!showMyAimMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (myAimMenuRef.current && !myAimMenuRef.current.contains(e.target as Node)) {
        setShowMyAimMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMyAimMenu]);

  // Track previous friend statuses for sound effects
  const previousStatusesRef = useRef<Map<string, string>>(new Map());

  // Auto-away after 10 minutes of inactivity
  const inactivityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wasAutoAwayRef = useRef(false);
  const profileStatusRef = useRef(profile?.status);
  const AUTO_AWAY_TIMEOUT = 10 * 60 * 1000; // 10 minutes

  // Keep status ref in sync
  useEffect(() => {
    profileStatusRef.current = profile?.status;
  }, [profile?.status]);

  useEffect(() => {
    const resetInactivityTimer = () => {
      // Clear existing timer
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }

      // If user was auto-away and is now active, set them back to online
      if (wasAutoAwayRef.current && profileStatusRef.current === 'away') {
        updateStatus('online');
        wasAutoAwayRef.current = false;
      }

      // Set new timer — only if user is online (don't override manual away)
      if (profileStatusRef.current === 'online') {
        inactivityTimerRef.current = setTimeout(() => {
          if (profileStatusRef.current === 'online') {
            updateStatus('away', 'Auto-away: Inactive');
            wasAutoAwayRef.current = true;
          }
        }, AUTO_AWAY_TIMEOUT);
      }
    };

    // Activity events to track
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];

    // Add listeners
    events.forEach(event => {
      document.addEventListener(event, resetInactivityTimer, { passive: true });
    });

    // Start initial timer
    resetInactivityTimer();

    return () => {
      // Cleanup
      events.forEach(event => {
        document.removeEventListener(event, resetInactivityTimer);
      });
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    loadFriends();
    loadConversations();

    // Subscribe to realtime updates for friends involving this user
    const friendsChannel = supabase
      .channel(`friends-changes-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friends', filter: `user_id=eq.${user.id}` }, () => {
        loadFriends();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friends', filter: `friend_id=eq.${user.id}` }, () => {
        loadFriends();
      })
      .subscribe();

    const profilesChannel = supabase
      .channel('profiles-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, (payload) => {
        const updatedProfile = payload.new as Profile;
        const previousStatus = previousStatusesRef.current.get(updatedProfile.id);

        // Play sound effects for friend status changes (not for self)
        if (updatedProfile.id !== user.id && previousStatus) {
          if (previousStatus !== 'online' && updatedProfile.status === 'online') {
            playSignOnSound();
            // Add to recently signed on set and remove after 3 seconds
            setRecentlySignedOn(prev => new Set(prev).add(updatedProfile.id));
            const timeout = setTimeout(() => {
              setRecentlySignedOn(prev => {
                const newSet = new Set(prev);
                newSet.delete(updatedProfile.id);
                return newSet;
              });
              signOnTimeouts.current.delete(timeout);
            }, 3000);
            signOnTimeouts.current.add(timeout);
          } else if (previousStatus === 'online' && updatedProfile.status !== 'online') {
            playSignOffSound();
          }
        }

        // Update tracked status
        previousStatusesRef.current.set(updatedProfile.id, updatedProfile.status);

        // Update only the specific friend's profile in state (not reload all)
        setFriends(prevFriends =>
          prevFriends.map(friend =>
            friend.profile?.id === updatedProfile.id
              ? { ...friend, profile: updatedProfile }
              : friend
          )
        );

        // Also update current user's profile if it's their own
        if (updatedProfile.id === user.id) {
          setProfile(updatedProfile);
        }
      })
      .subscribe();

    // Subscribe to incoming messages for auto-opening chat windows
    const messagesChannel = supabase
      .channel(`incoming-messages-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      }, async (payload) => {
        const newMessage = payload.new as Message;

        // Ignore own messages
        if (newMessage.sender_id === user.id) return;

        // Check if user is a participant in this conversation
        const { data: participation } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('conversation_id', newMessage.conversation_id)
          .eq('user_id', user.id)
          .single();

        if (!participation) return;

        // Get conversation name for the window title
        const { data: convo } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', newMessage.conversation_id)
          .single();

        // Get sender's screen name as fallback window title
        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('screen_name')
          .eq('id', newMessage.sender_id)
          .single();

        const windowName = convo?.name || senderProfile?.screen_name || 'Chat';

        // Check if chat window is already open
        const isOpen = await window.electronAPI?.isChatWindowOpen(newMessage.conversation_id);

        if (isOpen) {
          // Window is open — sound is handled by ChatWindow component
        } else {
          // Window is not open — auto-open it
          window.electronAPI?.openChatWindow(newMessage.conversation_id, windowName);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(friendsChannel);
      supabase.removeChannel(profilesChannel);
      supabase.removeChannel(messagesChannel);
      signOnTimeouts.current.forEach(t => clearTimeout(t));
      signOnTimeouts.current.clear();
    };
  }, [user.id]);

  async function loadFriends() {
    setLoadingFriends(true);
    try {
      // Get accepted friends
      const { data: friendships } = await supabase
        .from('friends')
        .select('*')
        .or(`user_id.eq.${user.id},friend_id.eq.${user.id}`)
        .eq('status', 'accepted');

      if (friendships) {
        const friendIds = friendships.map(f => f.user_id === user.id ? f.friend_id : f.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', friendIds);

        const friendsWithProfiles = friendships.map(f => ({
          ...f,
          profile: profiles?.find(p => p.id === (f.user_id === user.id ? f.friend_id : f.user_id))
        }));

        // Initialize status tracking for sound effects
        profiles?.forEach(p => {
          if (!previousStatusesRef.current.has(p.id)) {
            previousStatusesRef.current.set(p.id, p.status);
          }
        });

        setFriends(friendsWithProfiles);
      }

      // Get pending requests (where current user is the recipient)
      const { data: pending } = await supabase
        .from('friends')
        .select('*')
        .eq('friend_id', user.id)
        .eq('status', 'pending');

      if (pending) {
        const senderIds = pending.map(p => p.user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', senderIds);

        const pendingWithProfiles = pending.map(p => ({
          ...p,
          profile: profiles?.find(pr => pr.id === p.user_id)
        }));
        setPendingRequests(pendingWithProfiles);
      }
    } finally {
      setLoadingFriends(false);
    }
  }

  async function loadConversations() {
    setLoadingConversations(true);
    try {
      const { data: participations } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (!participations?.length) {
        setConversations([]);
        return;
      }

      const conversationIds = participations.map(p => p.conversation_id);
      const { data: convos } = await supabase
        .from('conversations')
        .select('*')
        .in('id', conversationIds);

      if (convos) {
        // Load participants for each conversation
        const convosWithParticipants = await Promise.all(convos.map(async (c) => {
          const { data: parts } = await supabase
            .from('conversation_participants')
            .select('user_id')
            .eq('conversation_id', c.id);

          const userIds = parts?.map(p => p.user_id) || [];
          const { data: profiles } = await supabase
            .from('profiles')
            .select('*')
            .in('id', userIds);

          return { ...c, participants: profiles || [] };
        }));
        setConversations(convosWithParticipants);
      }
    } finally {
      setLoadingConversations(false);
    }
  }

  async function startDirectMessage(friendId: string) {
    // Prevent concurrent calls that could create duplicate conversations
    if (startingDMRef.current) return;
    startingDMRef.current = true;

    try {
    console.log('startDirectMessage called with friendId:', friendId);
    const isSelfChat = friendId === user.id;

    // Get friend's profile for the conversation name
    const { data: friendProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', friendId)
      .single();

    // Check database for existing DM conversation with this friend
    const { data: myConvos } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', user.id);

    if (myConvos && myConvos.length > 0) {
      const myConvoIds = myConvos.map(c => c.conversation_id);

      if (isSelfChat) {
        // Batch fetch: get all non-group conversations and their participants in 2 queries
        const { data: nonGroupConvos } = await supabase
          .from('conversations')
          .select('id')
          .in('id', myConvoIds)
          .eq('is_group', false);

        if (nonGroupConvos && nonGroupConvos.length > 0) {
          const nonGroupIds = nonGroupConvos.map(c => c.id);
          const { data: allParticipants } = await supabase
            .from('conversation_participants')
            .select('conversation_id, user_id')
            .in('conversation_id', nonGroupIds);

          if (allParticipants) {
            // Group participants by conversation
            const participantsByConvo = new Map<string, string[]>();
            for (const p of allParticipants) {
              const list = participantsByConvo.get(p.conversation_id) || [];
              list.push(p.user_id);
              participantsByConvo.set(p.conversation_id, list);
            }

            // Find self-chat: conversation with only the current user
            for (const [convoId, userIds] of participantsByConvo) {
              const unique = [...new Set(userIds)];
              if (unique.length === 1 && unique[0] === user.id) {
                console.log('Opening existing self-chat:', convoId);
                window.electronAPI?.openChatWindow(
                  convoId,
                  friendProfile?.screen_name || 'Chat'
                );
                return;
              }
            }
          }
        }
      } else {
        // Find conversations where friend is also a participant
        const { data: sharedConvos } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', friendId)
          .in('conversation_id', myConvoIds);

        if (sharedConvos && sharedConvos.length > 0) {
          // For each shared conversation, verify it's a 2-person DM (not self-chat or group)
          for (const shared of sharedConvos) {
            const { data: participants } = await supabase
              .from('conversation_participants')
              .select('user_id')
              .eq('conversation_id', shared.conversation_id);

            const { data: dmConvo } = await supabase
              .from('conversations')
              .select('*')
              .eq('id', shared.conversation_id)
              .eq('is_group', false)
              .single();

            if (dmConvo && participants) {
              const uniqueParticipants = [...new Set(participants.map(p => p.user_id))];
              // Must have exactly 2 unique participants (user and friend)
              if (uniqueParticipants.length === 2) {
                console.log('Opening existing DM conversation:', dmConvo.id);
                window.electronAPI?.openChatWindow(
                  dmConvo.id,
                  friendProfile?.screen_name || 'Chat'
                );
                return;
              }
            }
          }
        }
      }
    }

    // Create new conversation
    const { data: convo } = await supabase
      .from('conversations')
      .insert({ is_group: false })
      .select()
      .single();

    if (convo) {
      if (isSelfChat) {
        // For self-chat, only add one participant entry
        await supabase.from('conversation_participants').insert([
          { conversation_id: convo.id, user_id: user.id }
        ]);
      } else {
        // Add both participants
        await supabase.from('conversation_participants').insert([
          { conversation_id: convo.id, user_id: user.id },
          { conversation_id: convo.id, user_id: friendId }
        ]);
      }

      // Open the new conversation in a new window
      console.log('Opening new conversation:', convo.id);
      window.electronAPI?.openChatWindow(
        convo.id,
        friendProfile?.screen_name || 'Chat'
      );

      await loadConversations();
    }
    } finally {
      startingDMRef.current = false;
    }
  }

  async function updateAvatar(emoji: string) {
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: emoji })
      .eq('id', user.id);

    if (error) {
      console.error('Failed to update avatar:', error);
      return;
    }

    if (profile) {
      setProfile({ ...profile, avatar_url: emoji });
    }
    setShowAvatarPicker(false);
  }

  async function updateStatus(status: Status, awayMessage?: string) {
    const updateData: { status: Status; away_message?: string | null } = { status };

    // Clear away message when going online, set it when going away
    if (status === 'online') {
      updateData.away_message = null;
    } else if (status === 'away' && awayMessage !== undefined) {
      updateData.away_message = awayMessage;
    }

    await supabase
      .from('profiles')
      .update(updateData)
      .eq('id', user.id);

    if (profile) {
      setProfile({ ...profile, ...updateData });
    }
  }

  function handleStatusChange(newStatus: Status) {
    if (newStatus === 'away') {
      setShowAwayMessage(true);
    } else {
      updateStatus(newStatus);
    }
  }

  const getStatusColor = (status: Status | undefined) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'away': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="h-screen bg-win-gray flex flex-col win-raised">
        {/* AIM Title Bar */}
        <div className="win-titlebar">
          <span className="text-sm">{profile?.screen_name}'s Buddy List</span>
        </div>

        {/* Menu Bar */}
        <div className="bg-win-gray border-b border-win-border-dark px-1 py-0.5 flex gap-3 text-sm">
          <div className="relative" ref={myAimMenuRef}>
            <button className="hover:bg-win-gray-light px-1" onClick={() => setShowMyAimMenu(!showMyAimMenu)}>
              <span className="underline">M</span>y AIM
            </button>
            {showMyAimMenu && (
              <div className="absolute top-full left-0 bg-win-gray win-raised z-50 shadow-lg min-w-[140px]">
                <button
                  onClick={() => { onLogout(); setShowMyAimMenu(false); }}
                  className="w-full text-left px-3 py-1 text-sm hover:bg-[#316AC5] hover:text-white"
                >
                  Sign Off
                </button>
              </div>
            )}
          </div>
          <button className="hover:bg-win-gray-light px-1" onClick={() => setShowAddFriend(true)}>
            <span className="underline">P</span>eople
          </button>
        </div>

        {/* Profile Bar */}
        <div className="bg-win-gray px-2 py-1.5 border-b border-win-border-dark flex items-center gap-2">
          <div className="relative" ref={avatarPickerRef}>
            <button
              onClick={() => setShowAvatarPicker(!showAvatarPicker)}
              className="w-8 h-8 rounded bg-aim-yellow flex items-center justify-center text-sm hover:brightness-110 cursor-pointer"
              title="Change avatar"
              style={{ border: '1px solid #808080' }}
            >
              {profile?.avatar_url || '😎'}
            </button>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-white ${getStatusColor(profile?.status as Status)}`} />
            {showAvatarPicker && (
              <div className="absolute top-10 left-0 z-50 bg-win-gray win-raised p-2 w-36">
                <p className="text-xs text-gray-600 font-bold mb-1">Choose Avatar</p>
                <div className="grid grid-cols-3 gap-1">
                  {AVATAR_OPTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => updateAvatar(emoji)}
                      className={`w-9 h-9 flex items-center justify-center text-lg hover:bg-aim-yellow/30 ${
                        profile?.avatar_url === emoji ? 'bg-aim-yellow/40 win-sunken' : 'win-raised'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-gray-800 truncate">{profile?.screen_name}</div>
            <select
              value={profile?.status || 'online'}
              onChange={(e) => handleStatusChange(e.target.value as Status)}
              className="text-xs bg-transparent text-gray-600 border-none focus:outline-none cursor-pointer p-0"
            >
              <option value="online">Online</option>
              <option value="away">Away</option>
              <option value="offline">Invisible</option>
            </select>
          </div>
        </div>

        {/* Action Buttons Bar */}
        <div className="bg-win-gray px-1 py-1 border-b border-win-border-dark flex gap-1">
          <button onClick={() => setShowAddFriend(true)} className="win-button text-sm flex-1">Add Buddy</button>
          <button onClick={() => setShowCreateGroup(true)} className="win-button text-sm flex-1">Chat</button>
        </div>

        {/* Buddy List Content */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="py-1">
            {pendingRequests.length > 0 && (
              <div className="text-xs text-red-600 font-bold px-3 py-1 bg-red-50">
                {pendingRequests.length} pending request{pendingRequests.length > 1 ? 's' : ''}
              </div>
            )}

              {loadingFriends ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-500"></div>
                </div>
              ) : (
                <>
                  {/* Pending Requests */}
                  {pendingRequests.length > 0 && (
                    <div className="mb-1">
                      <div className="text-xs font-bold text-gray-600 px-3 py-0.5 bg-win-gray-light border-b border-gray-300">Friend Requests</div>
                      {pendingRequests.map((request) => (
                        <FriendRequestItem key={request.id} request={request} onUpdate={loadFriends} />
                      ))}
                    </div>
                  )}

                  {/* Buddies List - Online */}
                  <div>
                    <button
                      onClick={() => setBuddiesCollapsed(!buddiesCollapsed)}
                      className="flex items-center gap-1 text-sm font-bold text-gray-700 px-2 py-0.5 hover:bg-gray-100 w-full text-left bg-win-gray-light border-b border-gray-200"
                    >
                      <span className="text-xs">{buddiesCollapsed ? '▶' : '▼'}</span>
                      Buddies ({friends.filter(f => f.profile?.status === 'online' || f.profile?.status === 'away').length + (profile?.status === 'online' || profile?.status === 'away' ? 1 : 0)}/{friends.length + 1})
                    </button>
                    {!buddiesCollapsed && (
                      <>
                        {/* Self - current user */}
                        {profile && (profile.status === 'online' || profile.status === 'away') && (
                          <button
                            onClick={() => startDirectMessage(user.id)}
                            className="w-full py-0.5 px-5 hover:bg-[#316AC5] hover:text-white transition-colors text-left flex items-center gap-1.5"
                          >
                            <span className="text-xs">{profile.status === 'away' ? '📝' : '👤'}</span>
                            <span className={`text-sm ${profile.status === 'away' ? 'italic text-gray-500' : 'text-gray-800'}`}>
                              {profile.screen_name}
                            </span>
                          </button>
                        )}
                        {friends
                          .filter(f => f.profile?.status === 'online' || f.profile?.status === 'away')
                          .map((friend) => (
                            <FriendItem
                              key={friend.id}
                              friend={friend}
                              onMessage={() => {
                              if (friend.profile?.status === 'away') {
                                setViewingProfileId(friend.profile.id);
                              } else if (friend.profile) {
                                startDirectMessage(friend.profile.id);
                              }
                            }}
                              getStatusColor={getStatusColor}
                              disabled={false}
                              recentlySignedOn={!!friend.profile && recentlySignedOn.has(friend.profile.id)}
                            />
                          ))
                        }
                        {friends.length === 0 && !(profile?.status === 'online' || profile?.status === 'away') && (
                          <p className="text-gray-400 text-xs px-5 py-1">No buddies online</p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Groups List */}
                  <div>
                    <button
                      onClick={() => setGroupsCollapsed(!groupsCollapsed)}
                      className="flex items-center gap-1 text-sm font-bold text-gray-700 px-2 py-0.5 hover:bg-gray-100 w-full text-left bg-win-gray-light border-b border-gray-200"
                    >
                      <span className="text-xs">{groupsCollapsed ? '▶' : '▼'}</span>
                      Groups ({conversations.filter(c => c.is_group).length})
                    </button>
                    {!groupsCollapsed && (
                      conversations.filter(c => c.is_group).length === 0 ? (
                        <p className="text-gray-400 text-xs px-5 py-1">No groups yet</p>
                      ) : (
                        conversations
                          .filter(c => c.is_group)
                          .map((convo) => (
                            <button
                              key={convo.id}
                              onClick={() => window.electronAPI?.openChatWindow(convo.id, convo.name || 'Group Chat')}
                              className="w-full py-0.5 px-5 hover:bg-[#316AC5] hover:text-white transition-colors text-left flex items-center gap-1.5"
                            >
                              <span className="text-xs">👥</span>
                              <span className="text-sm text-gray-800">
                                {convo.name || 'Group Chat'}
                              </span>
                            </button>
                          ))
                      )
                    )}
                  </div>

                  {/* Buddies List - Offline */}
                  <div>
                    <button
                      onClick={() => setOfflineCollapsed(!offlineCollapsed)}
                      className="flex items-center gap-1 text-sm font-bold text-gray-700 px-2 py-0.5 hover:bg-gray-100 w-full text-left bg-win-gray-light border-b border-gray-200"
                    >
                      <span className="text-xs">{offlineCollapsed ? '▶' : '▼'}</span>
                      Offline ({friends.filter(f => f.profile?.status === 'offline' || !f.profile?.status).length + (profile?.status === 'offline' || !profile?.status ? 1 : 0)}/{friends.length + 1})
                    </button>
                    {!offlineCollapsed && (
                      <>
                        {/* Self - current user if offline */}
                        {profile && (profile.status === 'offline' || !profile.status) && (
                          <button
                            onClick={() => startDirectMessage(user.id)}
                            className="w-full py-0.5 px-5 hover:bg-[#316AC5] hover:text-white transition-colors text-left flex items-center gap-1.5"
                          >
                            <span className="text-xs opacity-40">👤</span>
                            <span className="text-sm text-gray-400">
                              {profile.screen_name}
                            </span>
                          </button>
                        )}
                        {friends
                          .filter(f => f.profile?.status === 'offline' || !f.profile?.status)
                          .map((friend) => (
                            <FriendItem
                              key={friend.id}
                              friend={friend}
                              onMessage={() => {
                              if (friend.profile?.status === 'away') {
                                setViewingProfileId(friend.profile.id);
                              } else if (friend.profile) {
                                startDirectMessage(friend.profile.id);
                              }
                            }}
                              getStatusColor={getStatusColor}
                              disabled={false}
                              recentlySignedOn={!!friend.profile && recentlySignedOn.has(friend.profile.id)}
                            />
                          ))
                        }
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
        </div>

        {/* Bottom: I am Away button */}
        <div className="bg-win-gray border-t border-win-border-dark p-1">
          {profile?.status === 'away' ? (
            <button
              onClick={() => updateStatus('online')}
              className="win-button w-full text-sm py-1 font-bold text-red-700"
            >
              I'm Back (Cancel Away)
            </button>
          ) : (
            <button
              onClick={() => setShowAwayMessage(true)}
              className="win-button w-full text-sm py-1"
            >
              Set Away Message
            </button>
          )}
        </div>

      {/* Modals */}
      {showAddFriend && (
        <AddFriendModal
          currentUserId={user.id}
          onClose={() => setShowAddFriend(false)}
          onSuccess={() => { setShowAddFriend(false); loadFriends(); }}
        />
      )}

      {showCreateGroup && (
        <CreateGroupModal
          currentUserId={user.id}
          friends={friends}
          onClose={() => setShowCreateGroup(false)}
          onSuccess={() => { setShowCreateGroup(false); loadConversations(); }}
        />
      )}

      {showAwayMessage && (
        <AwayMessageModal
          currentMessage={profile?.away_message || ''}
          onClose={() => setShowAwayMessage(false)}
          onSave={(message) => {
            updateStatus('away', message);
            setShowAwayMessage(false);
          }}
        />
      )}

      {viewingProfile && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-win-gray win-raised w-full max-w-xs">
            <div className="win-titlebar justify-between">
              <span className="text-xs">Buddy Info</span>
              <button onClick={() => setViewingProfileId(null)} className="text-white hover:bg-red-500 px-1.5 text-xs leading-none">x</button>
            </div>
            <div className="p-4 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded bg-aim-yellow text-3xl mb-2" style={{ border: '2px solid #808080' }}>
                {viewingProfile.avatar_url || '😎'}
              </div>
              <div className="text-sm font-bold text-gray-800 mb-1">{viewingProfile.screen_name}</div>
              <div className="flex items-center justify-center gap-1 mb-3">
                <span className={`w-2 h-2 rounded-full ${getStatusColor(viewingProfile.status as Status)}`}></span>
                <span className="text-xs text-gray-500 capitalize">{viewingProfile.status || 'offline'}</span>
              </div>
              {viewingProfile.away_message && (
                <div className="win-sunken bg-white p-2 text-xs text-left mb-3">
                  <div className="text-gray-500 text-xs mb-1 font-bold">Away Message:</div>
                  <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(viewingProfile.away_message) }} />
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    startDirectMessage(viewingProfile.id);
                    setViewingProfileId(null);
                  }}
                  className="win-button flex-1 text-xs py-1"
                >
                  Send Message
                </button>
                <button
                  onClick={() => setViewingProfileId(null)}
                  className="win-button flex-1 text-xs py-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FriendRequestItem({ request, onUpdate }: { request: Friend; onUpdate: () => void }) {
  const handleAccept = async () => {
    await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .eq('id', request.id);
    onUpdate();
  };

  const handleDecline = async () => {
    await supabase
      .from('friends')
      .delete()
      .eq('id', request.id);
    onUpdate();
  };

  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-aim-yellow/10 border-b border-gray-200">
      <span className="text-xs">❓</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-800 truncate">{request.profile?.screen_name}</p>
        <p className="text-xs text-gray-500">Wants to be buddies</p>
      </div>
      <button onClick={handleAccept} className="win-button text-xs px-2 py-0.5 text-green-700">Accept</button>
      <button onClick={handleDecline} className="win-button text-xs px-2 py-0.5 text-red-700">Deny</button>
    </div>
  );
}

function FriendItem({ friend, onMessage, getStatusColor, disabled, recentlySignedOn }: {
  friend: Friend;
  onMessage: () => void;
  getStatusColor: (status: Status | undefined) => string;
  disabled?: boolean;
  recentlySignedOn?: boolean;
}) {
  const isAway = friend.profile?.status === 'away';

  const isOffline = friend.profile?.status === 'offline' || !friend.profile?.status;
  const statusIcon = isOffline ? '👤' : isAway ? '📝' : '👤';

  return (
    <button
      onClick={onMessage}
      disabled={disabled}
      className={`w-full py-0.5 px-5 hover:bg-[#316AC5] hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-wait flex items-center gap-1.5 ${recentlySignedOn ? 'bg-aim-yellow/20' : ''}`}
    >
      <span className={`text-xs ${isOffline ? 'opacity-40' : ''}`}>{statusIcon}</span>
      <span className={`text-sm ${isOffline ? 'text-gray-400' : isAway ? 'italic text-gray-500' : 'text-gray-800'}`}>
        {friend.profile?.screen_name}
      </span>
      {recentlySignedOn && (
        <span className="text-xs text-green-600 ml-auto">*</span>
      )}
    </button>
  );
}

function ConversationItem({ conversation, currentUserId, isActive, onClick, getStatusColor, currentUserName }: {
  conversation: Conversation;
  currentUserId: string;
  isActive: boolean;
  onClick: () => void;
  getStatusColor: (status: Status | undefined) => string;
  currentUserName?: string;
}) {
  const otherParticipants = conversation.participants?.filter(p => p.id !== currentUserId) || [];
  const isSelfChat = otherParticipants.length === 0 && !conversation.is_group;
  const displayName = conversation.is_group
    ? conversation.name || 'Group Chat'
    : isSelfChat
      ? currentUserName || 'Me'
      : otherParticipants[0]?.screen_name || 'Unknown';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-2 rounded transition-colors text-left ${
        isActive ? 'bg-blue-100 border border-gray-400' : 'hover:bg-gray-100'
      }`}
    >
      <div className="relative">
        <div className={`w-8 h-8 rounded border border-gray-400 flex items-center justify-center text-sm ${
          conversation.is_group ? 'bg-purple-300' : 'bg-blue-300'
        }`}>
          {conversation.is_group ? '👥' : (otherParticipants[0]?.avatar_url || '👾')}
        </div>
        {!conversation.is_group && !isSelfChat && (
          <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(otherParticipants[0]?.status as Status)}`} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-gray-800 text-sm font-medium truncate">{displayName}</p>
        {conversation.is_group && (
          <p className="text-gray-500 text-xs">{conversation.participants?.length || 0} members</p>
        )}
      </div>
    </button>
  );
}

// Type for away message entries displayed in chat
interface AwayMessageEntry {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
}

function ChatArea({ conversation, messages, currentUserId, profile, loadingMessages }: {
  conversation: Conversation;
  messages: Message[];
  currentUserId: string;
  profile: Profile | null;
  loadingMessages?: boolean;
}) {
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [hangoutParticipants, setHangoutParticipants] = useState<HangoutSession[]>([]);
  const [isInHangout, setIsInHangout] = useState(false);
  const [joiningHangout, setJoiningHangout] = useState(false);
  const [awayMessages, setAwayMessages] = useState<AwayMessageEntry[]>([]);
  const shownInitialAwayRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const typingRemovalTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const channelRef = useRef<RealtimeChannel | null>(null);

  const otherParticipants = conversation.participants?.filter(p => p.id !== currentUserId) || [];
  const isSelfChat = otherParticipants.length === 0 && !conversation.is_group;
  const displayName = conversation.is_group
    ? conversation.name || 'Group Chat'
    : isSelfChat
      ? profile?.screen_name || 'Me'
      : otherParticipants[0]?.screen_name || 'Unknown';

  // Show away message immediately when chat window opens if participant is away
  useEffect(() => {
    if (loadingMessages || shownInitialAwayRef.current) return;
    shownInitialAwayRef.current = true;

    const newAwayMessages: AwayMessageEntry[] = [];

    // Check other participants for away messages
    otherParticipants
      .filter(p => p.status === 'away' && p.away_message)
      .forEach(p => {
        newAwayMessages.push({
          id: `away-init-${p.id}`,
          senderId: p.id,
          senderName: p.screen_name || 'Unknown',
          content: p.away_message || '',
          timestamp: new Date().toISOString()
        });
      });

    // Show own away message if current user is away (e.g. window auto-opened from incoming message)
    if (!isSelfChat && profile?.status === 'away' && profile?.away_message) {
      newAwayMessages.push({
        id: `away-init-self-${currentUserId}`,
        senderId: currentUserId,
        senderName: profile.screen_name || 'Me',
        content: profile.away_message,
        timestamp: new Date().toISOString()
      });
    }

    // For self-chat, show own away message if away
    if (isSelfChat && profile?.status === 'away' && profile?.away_message) {
      newAwayMessages.push({
        id: `away-init-${currentUserId}`,
        senderId: currentUserId,
        senderName: profile.screen_name || 'Me',
        content: profile.away_message,
        timestamp: new Date().toISOString()
      });
    }

    if (newAwayMessages.length > 0) {
      setAwayMessages(prev => [...prev, ...newAwayMessages]);
    }
  }, [loadingMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, awayMessages, typingUsers]);

  // Load and subscribe to hangout participants
  useEffect(() => {
    loadHangoutParticipants();

    const hangoutChannel = supabase
      .channel(`hangout-${conversation.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hangout_sessions',
        filter: `conversation_id=eq.${conversation.id}`
      }, () => {
        loadHangoutParticipants();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(hangoutChannel);
    };
  }, [conversation.id]);

  async function loadHangoutParticipants() {
    const { data } = await supabase
      .from('hangout_sessions')
      .select('*')
      .eq('conversation_id', conversation.id);

    if (data) {
      // Get profiles for participants
      const userIds = data.map(h => h.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      const participantsWithProfiles = data.map(h => ({
        ...h,
        profile: profiles?.find(p => p.id === h.user_id)
      }));

      setHangoutParticipants(participantsWithProfiles);
      setIsInHangout(data.some(h => h.user_id === currentUserId));

      // Note: Hangout overlay window feature disabled for now
      // TODO: Implement proper hangout overlay when ready
    }
  }

  async function joinHangout() {
    setJoiningHangout(true);
    try {
      await supabase.from('hangout_sessions').insert({
        conversation_id: conversation.id,
        user_id: currentUserId,
        avatar_x: 100 + Math.random() * 200,
        avatar_y: 100 + Math.random() * 100
      });
      setIsInHangout(true);
    } catch (error) {
      console.error('Failed to join hangout:', error);
    }
    setJoiningHangout(false);
  }

  async function leaveHangout() {
    await supabase
      .from('hangout_sessions')
      .delete()
      .eq('conversation_id', conversation.id)
      .eq('user_id', currentUserId);

    setIsInHangout(false);
  }

  // Set up typing indicator channel
  useEffect(() => {
    const channel = supabase.channel(`typing-${conversation.id}`);

    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload.userId !== currentUserId) {
          setTypingUsers(prev => {
            if (!prev.includes(payload.screenName)) {
              return [...prev, payload.screenName];
            }
            return prev;
          });

          // Clear existing timeout for this user, then set a new one
          const existingTimeout = typingRemovalTimeouts.current.get(payload.screenName);
          if (existingTimeout) clearTimeout(existingTimeout);

          const timeout = setTimeout(() => {
            setTypingUsers(prev => prev.filter(name => name !== payload.screenName));
            typingRemovalTimeouts.current.delete(payload.screenName);
          }, 3000);
          typingRemovalTimeouts.current.set(payload.screenName, timeout);
        }
      })
      .on('broadcast', { event: 'stop_typing' }, ({ payload }) => {
        if (payload.userId !== currentUserId) {
          setTypingUsers(prev => prev.filter(name => name !== payload.screenName));
        }
      })
      .on('broadcast', { event: 'away_reply' }, ({ payload }) => {
        const awayEntry: AwayMessageEntry = {
          id: payload.id,
          senderId: payload.senderId,
          senderName: payload.senderName,
          content: payload.content,
          timestamp: payload.timestamp,
        };
        setAwayMessages(prev => {
          // Avoid duplicates
          if (prev.some(a => a.id === awayEntry.id)) return prev;
          return [...prev, awayEntry];
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingRemovalTimeouts.current.forEach(t => clearTimeout(t));
      typingRemovalTimeouts.current.clear();
    };
  }, [conversation.id, currentUserId]);

  const broadcastTyping = () => {
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: { userId: currentUserId, screenName: profile?.screen_name }
      });

      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      // Set timeout to broadcast stop typing
      typingTimeoutRef.current = setTimeout(() => {
        if (channelRef.current) {
          channelRef.current.send({
            type: 'broadcast',
            event: 'stop_typing',
            payload: { userId: currentUserId, screenName: profile?.screen_name }
          });
        }
      }, 2000);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    // Clear typing timeout and broadcast stop typing
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    if (channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'stop_typing',
        payload: { userId: currentUserId, screenName: profile?.screen_name }
      });
    }

    setSending(true);
    const { error } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender_id: currentUserId,
      content: newMessage.trim()
    });

    if (error) {
      console.error('Failed to send message:', error);
      setSending(false);
      return;
    }

    // After sending, check if any participants are away and broadcast their away message
    // Use a timestamp slightly in the future so it sorts after the sent message
    const awayTimestamp = new Date(Date.now() + 1000).toISOString();
    const newAwayMessages: AwayMessageEntry[] = [];

    // Check other participants for away messages (every time)
    const awayParticipants = otherParticipants.filter(p => p.status === 'away' && p.away_message);
    awayParticipants.forEach(p => {
      newAwayMessages.push({
        id: `away-${p.id}-${Date.now()}`,
        senderId: p.id,
        senderName: p.screen_name || 'Unknown',
        content: p.away_message || '',
        timestamp: awayTimestamp
      });
    });

    // For self-chat, also show own away message if away
    if (isSelfChat && profile?.status === 'away' && profile?.away_message) {
      newAwayMessages.push({
        id: `away-${currentUserId}-${Date.now()}`,
        senderId: currentUserId,
        senderName: profile.screen_name || 'Me',
        content: profile.away_message,
        timestamp: awayTimestamp
      });
    }

    if (newAwayMessages.length > 0) {
      setTimeout(() => {
        if (isSelfChat) {
          // Self-chat: add directly to local state (broadcast won't echo back to sender)
          setAwayMessages(prev => {
            const newEntries = newAwayMessages.filter(msg => !prev.some(a => a.id === msg.id));
            return [...prev, ...newEntries];
          });
        } else {
          // Broadcast away messages so both sides see them
          newAwayMessages.forEach(msg => {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'away_reply',
              payload: msg,
            });
          });
        }
      }, 500);
    }

    setNewMessage('');
    setSending(false);
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);
    if (value.trim()) {
      broadcastTyping();
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-win-gray overflow-hidden">
      {/* Messages area */}
      <div className="flex-1 min-h-0 overflow-y-auto bg-white win-sunken m-1 p-2" style={{ fontSize: 'medium' }}>
        {loadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500 text-xs">Loading messages...</p>
          </div>
        ) : messages.length === 0 && awayMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-400 text-xs">No messages yet. Say hello!</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {(() => {
              const allItems: Array<{type: 'message' | 'away', data: Message | AwayMessageEntry, timestamp: string}> = [
                ...messages.map(m => ({ type: 'message' as const, data: m, timestamp: m.created_at })),
                ...awayMessages.map(a => ({ type: 'away' as const, data: a, timestamp: a.timestamp }))
              ];
              allItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

              let lastDateStr = '';
              const elements: React.ReactNode[] = [];

              allItems.forEach((item) => {
                // Insert date separator when the day changes
                const itemDate = new Date(item.timestamp);
                const dateStr = itemDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                if (dateStr !== lastDateStr) {
                  lastDateStr = dateStr;
                  const today = new Date();
                  const yesterday = new Date(today);
                  yesterday.setDate(yesterday.getDate() - 1);
                  let displayDate = dateStr;
                  if (itemDate.toDateString() === today.toDateString()) {
                    displayDate = 'Today';
                  } else if (itemDate.toDateString() === yesterday.toDateString()) {
                    displayDate = 'Yesterday';
                  }
                  elements.push(
                    <div key={`date-${dateStr}`} className="flex items-center gap-2 my-2">
                      <div className="flex-1 border-t border-gray-300" />
                      <span className="text-xs text-gray-400 px-1">{displayDate}</span>
                      <div className="flex-1 border-t border-gray-300" />
                    </div>
                  );
                }
                if (item.type === 'away') {
                  const awayMsg = item.data as AwayMessageEntry;
                  const processedContent = processAwayMessageSpecialChars(
                    awayMsg.content,
                    profile?.screen_name
                  );
                  elements.push(
                    <div key={awayMsg.id}>
                      <span className="font-bold text-[#0000FF]">
                        {awayMsg.senderName} (away message):
                      </span>{' '}
                      <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(processedContent) }} />
                    </div>
                  );
                } else {
                  const message = item.data as Message;
                  const isOwn = message.sender_id === currentUserId;
                  const screenName = message.sender?.screen_name || (isOwn ? profile?.screen_name : 'Unknown');

                  if (isSelfChat) {
                    elements.push(
                      <React.Fragment key={message.id}>
                        <div>
                          <span className="font-bold text-[#0000FF]">
                            {screenName}:
                          </span>{' '}
                          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} />
                        </div>
                        <div>
                          <span className="font-bold text-[#FF0000]">
                            {screenName}:
                          </span>{' '}
                          <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} />
                        </div>
                      </React.Fragment>
                    );
                  } else {
                    elements.push(
                      <div key={message.id}>
                        <span className={`font-bold ${isOwn ? 'text-[#FF0000]' : 'text-[#0000FF]'}`}>
                          {screenName}:
                        </span>{' '}
                        <span dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }} />
                      </div>
                    );
                  }
                }
              });
              return elements;
            })()}
          </div>
        )}
        {/* Typing Indicator */}
        {typingUsers.length > 0 && (
          <div className="flex items-center gap-1 text-gray-500 py-0.5">
            <div className="flex gap-0.5">
              <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
              <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
              <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
            </div>
            <span className="text-xs italic">
              {typingUsers.length === 1
                ? `${typingUsers[0]} is typing...`
                : `${typingUsers.join(', ')} are typing...`}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area with formatting toolbar */}
      <div className="flex flex-col min-h-[120px]">
        <MessageInput
          value={newMessage}
          onChange={handleInputChange}
          onSend={handleSend}
          sending={sending}
        />
      </div>
    </div>
  );
}

const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪', '😎', '🤩', '🥳', '😏', '😒', '🙄', '😬', '😮', '🤐', '😯', '😲', '😳', '🥺', '😢', '😭', '😤', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
  'Gestures': ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '💪', '🦾'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💖', '💗', '💓', '💞', '💕', '💘', '💝'],
  'Animals': ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦄', '🐴', '🦋', '🐛', '🐝', '🐞'],
  'Food': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🍿', '🍩', '🍪', '🎂', '🍰', '☕', '🍵', '🧃', '🍺'],
  'Activities': ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🎮', '🎲', '🎭', '🎨', '🎬', '🎤', '🎧', '🎸', '🎹', '🥁', '🎯', '🎳', '🎰', '🎪'],
  'Objects': ['💡', '🔦', '🏮', '📱', '💻', '⌨️', '🖥️', '📷', '📹', '🎥', '📞', '☎️', '📺', '📻', '⏰', '⌚', '💰', '💎', '🔑', '🗝️', '🔒', '🔓', '❤️‍🔥', '💣', '🎁'],
  'Symbols': ['💯', '✨', '💥', '💫', '💦', '💨', '🔥', '⭐', '🌟', '✅', '❌', '❓', '❗', '💤', '💢', '💬', '👁️‍🗨️', '🗯️', '💭', '🕳️', '🚫', '⛔', '📛', '♻️', '✳️']
};

// Text colors for AIM-style formatting
const TEXT_COLORS = ['#ffffff', '#ff0000', '#ff6600', '#ffff00', '#00ff00', '#00ffff', '#0066ff', '#9900ff', '#ff00ff', '#000000'];
const HIGHLIGHT_COLORS = ['transparent', '#ffff00', '#00ff00', '#00ffff', '#ff00ff', '#ff6600', '#ff0000'];

function MessageInput({ value, onChange, onSend, sending }: {
  value: string;
  onChange: (val: string) => void;
  onSend: (e: React.FormEvent) => void;
  sending: boolean;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const savedSelectionRef = useRef<Range | null>(null);
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const editorRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close pickers when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      // Close color pickers if clicking outside
      const target = e.target as HTMLElement;
      if (!target.closest('.color-picker-container')) {
        setShowColorPicker(false);
        setShowHighlightPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const insertEmoji = (emoji: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('insertText', false, emoji);
      onChange(editorRef.current.innerHTML);
    }
  };

  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editorRef.current && editorRef.current.innerHTML.trim() && editorRef.current.textContent?.trim()) {
      onSend(e);
      editorRef.current.innerHTML = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInput = () => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  };

  return (
    <div className="h-full flex flex-col bg-win-gray">
      {/* Formatting Toolbar */}
      <div className="flex items-center gap-0.5 px-1 py-0.5 border-b border-win-border-dark bg-win-gray">
        {/* Bold */}
        <button
          type="button"
          onClick={() => applyFormat('bold')}
          className="win-button w-6 h-6 flex items-center justify-center text-xs font-bold p-0"
          title="Bold (Ctrl+B)"
        >
          B
        </button>
        {/* Italic */}
        <button
          type="button"
          onClick={() => applyFormat('italic')}
          className="win-button w-6 h-6 flex items-center justify-center text-xs italic p-0"
          title="Italic (Ctrl+I)"
        >
          I
        </button>
        {/* Underline */}
        <button
          type="button"
          onClick={() => applyFormat('underline')}
          className="win-button w-6 h-6 flex items-center justify-center text-xs underline p-0"
          title="Underline (Ctrl+U)"
        >
          U
        </button>

        <div className="w-px h-4 bg-win-border-dark mx-0.5" />

        {/* Font Size Smaller: small (2) */}
        <button
          type="button"
          onClick={() => applyFormat('fontSize', '2')}
          className="win-button w-6 h-6 flex items-center justify-center p-0"
          title="Small text"
        >
          <span className="text-xs">A</span>
        </button>
        {/* Font Size Normal: default (3) */}
        <button
          type="button"
          onClick={() => applyFormat('fontSize', '3')}
          className="win-button w-6 h-6 flex items-center justify-center p-0"
          title="Normal text"
        >
          <span className="text-xs">A</span>
        </button>
        {/* Font Size Larger: large (5) */}
        <button
          type="button"
          onClick={() => applyFormat('fontSize', '5')}
          className="win-button w-6 h-6 flex items-center justify-center p-0"
          title="Large text"
        >
          <span className="text-sm font-bold">A</span>
        </button>

        <div className="w-px h-4 bg-win-border-dark mx-0.5" />

        {/* Text Color */}
        <div className="relative color-picker-container">
          <button
            type="button"
            onClick={() => { setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); }}
            className="win-button w-6 h-6 flex items-center justify-center p-0 relative"
            title="Text color"
          >
            <span className="text-xs">A</span>
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500" />
          </button>
          {showColorPicker && (
            <div className="absolute bottom-8 left-0 bg-win-gray win-raised p-1.5 flex gap-0.5 flex-wrap w-24 z-50">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => { applyFormat('foreColor', color); setShowColorPicker(false); }}
                  className="w-4 h-4 border border-gray-500 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Highlight Color */}
        <div className="relative color-picker-container">
          <button
            type="button"
            onClick={() => { setShowHighlightPicker(!showHighlightPicker); setShowColorPicker(false); }}
            className="win-button w-6 h-6 flex items-center justify-center p-0"
            title="Highlight color"
          >
            <span className="text-xs font-bold px-0.5" style={{ backgroundColor: '#FFFF00' }}>ab</span>
          </button>
          {showHighlightPicker && (
            <div className="absolute bottom-8 left-0 bg-win-gray win-raised p-1.5 flex gap-0.5 z-50">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => { applyFormat('hiliteColor', color); setShowHighlightPicker(false); }}
                  className="w-4 h-4 border border-gray-500 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color === 'transparent' ? 'white' : color }}
                >
                  {color === 'transparent' && <span className="text-[8px] text-gray-400">✕</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Insert Link */}
        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              // Save selection before opening the input
              const selection = window.getSelection();
              if (selection && selection.rangeCount > 0) {
                savedSelectionRef.current = selection.getRangeAt(0).cloneRange();
              }
            }}
            onClick={() => { setShowLinkInput(!showLinkInput); setLinkUrl(''); }}
            className="win-button w-6 h-6 flex items-center justify-center p-0"
            title="Insert link"
          >
            <span className="text-xs underline text-[#0000FF]">🔗</span>
          </button>
          {showLinkInput && (
            <div className="fixed left-2 bg-win-gray win-raised p-2 z-[9999] shadow-lg" style={{ bottom: '140px', width: '260px' }}>
              <div className="text-xs font-bold mb-1">Insert Link</div>
              <input
                type="text"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (!linkUrl || !/^https?:\/\//i.test(linkUrl)) return;
                    if (editorRef.current) {
                      editorRef.current.focus();
                      if (savedSelectionRef.current) {
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        sel?.addRange(savedSelectionRef.current);
                      }
                      const sel = window.getSelection();
                      if (sel && sel.toString().length > 0) {
                        document.execCommand('createLink', false, linkUrl);
                      } else {
                        document.execCommand('insertHTML', false, `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkUrl}</a>`);
                      }
                      onChange(editorRef.current.innerHTML);
                    }
                    setShowLinkInput(false);
                    setLinkUrl('');
                  } else if (e.key === 'Escape') {
                    setShowLinkInput(false);
                  }
                }}
                className="win-input w-full py-0.5 text-xs mb-1"
                placeholder="https://..."
                autoFocus
              />
              <div className="flex gap-1 justify-end">
                <button
                  type="button"
                  onClick={() => setShowLinkInput(false)}
                  className="win-button text-xs px-2 py-0.5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!linkUrl || !/^https?:\/\//i.test(linkUrl)) return;
                    if (editorRef.current) {
                      editorRef.current.focus();
                      if (savedSelectionRef.current) {
                        const sel = window.getSelection();
                        sel?.removeAllRanges();
                        sel?.addRange(savedSelectionRef.current);
                      }
                      const sel = window.getSelection();
                      if (sel && sel.toString().length > 0) {
                        document.execCommand('createLink', false, linkUrl);
                      } else {
                        document.execCommand('insertHTML', false, `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkUrl}</a>`);
                      }
                      onChange(editorRef.current.innerHTML);
                    }
                    setShowLinkInput(false);
                    setLinkUrl('');
                  }}
                  className="win-button text-xs px-2 py-0.5 font-bold"
                >
                  Insert
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-px h-4 bg-win-border-dark mx-0.5" />

        {/* Emoji Picker */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="win-button w-6 h-6 flex items-center justify-center p-0"
            title="Emoticons"
          >
            <span className="text-sm">😊</span>
          </button>

          {showEmojiPicker && (
            <div className="fixed left-2 bg-win-gray win-raised w-72 overflow-hidden z-[9999] shadow-lg" style={{ bottom: '140px' }}>
              <div className="flex overflow-x-auto border-b border-win-border-dark p-1 gap-1 bg-win-gray-light">
                {Object.keys(EMOJI_CATEGORIES).map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`px-1.5 py-0.5 text-xs whitespace-nowrap ${
                      activeCategory === category
                        ? 'win-sunken bg-white font-bold'
                        : 'win-button'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <div className="p-1.5 h-48 overflow-y-auto">
                <div className="grid grid-cols-6 gap-1">
                  {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { insertEmoji(emoji); setShowEmojiPicker(false); }}
                      className="w-9 h-9 flex items-center justify-center text-2xl hover:bg-[#316AC5] rounded"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Message Input Area */}
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-1">
        <div
          ref={editorRef}
          contentEditable
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-white win-sunken px-2 py-1 overflow-y-auto"
          style={{ wordBreak: 'break-word', fontFamily: 'Arial, sans-serif', fontSize: 'medium' }}
          data-placeholder="Type a message..."
        />
        <div className="flex justify-end gap-1 mt-1">
          <button
            type="submit"
            disabled={sending}
            className="win-button px-4 py-0.5 font-bold text-xs disabled:opacity-50"
          >
            {sending ? '...' : 'Send'}
          </button>
        </div>
      </form>

      <style>{`
        [contenteditable]:empty:before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

function AddFriendModal({ currentUserId, onClose, onSuccess }: {
  currentUserId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [screenName, setScreenName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Find user by screen name
    const { data: targetUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('screen_name', screenName)
      .single();

    if (!targetUser) {
      setError('User not found');
      setLoading(false);
      return;
    }

    if (targetUser.id === currentUserId) {
      setError("You can't add yourself as a friend");
      setLoading(false);
      return;
    }

    // Check if friendship already exists
    const { data: existing } = await supabase
      .from('friends')
      .select('*')
      .or(`and(user_id.eq.${currentUserId},friend_id.eq.${targetUser.id}),and(user_id.eq.${targetUser.id},friend_id.eq.${currentUserId})`)
      .single();

    if (existing) {
      setError(existing.status === 'pending' ? 'Friend request already sent' : 'Already friends');
      setLoading(false);
      return;
    }

    // Send friend request
    const { error: insertError } = await supabase
      .from('friends')
      .insert({ user_id: currentUserId, friend_id: targetUser.id, status: 'pending' });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    onSuccess();
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-win-gray win-raised w-full max-w-xs">
        <div className="win-titlebar justify-between">
          <span className="text-xs">Add Buddy</span>
          <button onClick={onClose} className="text-white hover:bg-red-500 px-1.5 text-xs leading-none">x</button>
        </div>
        <form onSubmit={handleSubmit} className="p-3 space-y-3">
          {error && (
            <div className="p-2 bg-red-100 border border-red-400 text-red-700 text-xs">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs text-gray-700 mb-1">Screen Name</label>
            <input
              type="text"
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              className="win-input w-full py-1"
              placeholder="Enter buddy's screen name"
              required
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="win-button px-3 py-0.5 text-xs">Cancel</button>
            <button type="submit" disabled={loading} className="win-button px-3 py-0.5 text-xs font-bold disabled:opacity-50">
              {loading ? 'Sending...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateGroupModal({ currentUserId, friends, onClose, onSuccess }: {
  currentUserId: string;
  friends: Friend[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFriends.length === 0 || !groupName.trim()) return;

    setLoading(true);

    // Create group conversation
    const { data: convo } = await supabase
      .from('conversations')
      .insert({ name: groupName || null, is_group: true })
      .select()
      .single();

    if (convo) {
      // Add all participants including current user
      const participants = [currentUserId, ...selectedFriends].map(userId => ({
        conversation_id: convo.id,
        user_id: userId
      }));

      await supabase.from('conversation_participants').insert(participants);
      onSuccess();
    }

    setLoading(false);
  };

  const toggleFriend = (friendId: string) => {
    setSelectedFriends(prev =>
      prev.includes(friendId)
        ? prev.filter(id => id !== friendId)
        : [...prev, friendId]
    );
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-win-gray win-raised w-full max-w-xs">
        <div className="win-titlebar justify-between">
          <span className="text-xs">Create Chat Room</span>
          <button onClick={onClose} className="text-white hover:bg-red-500 px-1.5 text-xs leading-none">x</button>
        </div>
        <form onSubmit={handleSubmit} className="p-3 space-y-3">
          <div>
            <label className="block text-xs text-gray-700 mb-1">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="win-input w-full py-1"
              placeholder="Enter group name"
              required
            />
          </div>
          <div>
            <label className="block text-xs text-gray-700 mb-1">Select Buddies</label>
            <div className="space-y-0.5 max-h-36 overflow-y-auto bg-white win-sunken p-1">
              {friends.length === 0 ? (
                <p className="text-gray-500 text-xs p-1">Add some buddies first!</p>
              ) : (
                friends.filter(f => f.profile).map((friend) => {
                  const friendId = friend.profile!.id;
                  return (
                    <label
                      key={friend.id}
                      className={`flex items-center gap-2 px-1 py-0.5 cursor-pointer ${
                        selectedFriends.includes(friendId)
                          ? 'bg-[#316AC5] text-white'
                          : 'hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFriends.includes(friendId)}
                        onChange={() => toggleFriend(friendId)}
                        className="hidden"
                      />
                      <span className="text-xs">{friend.profile?.screen_name}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="win-button px-3 py-0.5 text-xs">Cancel</button>
            <button
              type="submit"
              disabled={loading || selectedFriends.length === 0 || !groupName.trim()}
              className="win-button px-3 py-0.5 text-xs font-bold disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SavedAwayMessage {
  id: string;
  label: string;
  message: string;
}

function AwayMessageModal({ currentMessage, onClose, onSave }: {
  currentMessage: string;
  onClose: () => void;
  onSave: (message: string) => void;
}) {
  const [message, setMessage] = useState(currentMessage);
  const [label, setLabel] = useState('');
  const [saveForLater, setSaveForLater] = useState(false);
  const [savedMessages, setSavedMessages] = useState<SavedAwayMessage[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState('Smileys');
  const editorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);
  const highlightPickerRef = useRef<HTMLDivElement>(null);

  // Set initial content
  useEffect(() => {
    if (editorRef.current && currentMessage) {
      editorRef.current.innerHTML = currentMessage;
    }
  }, []);

  // Close pickers when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
      if (highlightPickerRef.current && !highlightPickerRef.current.contains(e.target as Node)) {
        setShowHighlightPicker(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const insertEmoji = (emoji: string) => {
    if (editorRef.current) {
      editorRef.current.focus();
      document.execCommand('insertText', false, emoji);
      setMessage(editorRef.current.innerHTML);
    }
  };

  // Apply formatting using execCommand (same as chat)
  const applyFormat = (command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setMessage(editorRef.current.innerHTML);
    }
  };

  const applyColor = (color: string) => {
    applyFormat('foreColor', color);
    setShowColorPicker(false);
  };

  const applyHighlight = (color: string) => {
    applyFormat('hiliteColor', color);
    setShowHighlightPicker(false);
  };

  const handleInput = () => {
    if (editorRef.current) {
      setMessage(editorRef.current.innerHTML);
    }
  };

  // Load saved messages from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('aim_saved_away_messages');
    if (stored) {
      try {
        setSavedMessages(JSON.parse(stored));
      } catch (e) {
        console.error('Failed to load saved away messages:', e);
      }
    }
  }, []);

  // Save messages to localStorage whenever they change
  const persistMessages = (messages: SavedAwayMessage[]) => {
    localStorage.setItem('aim_saved_away_messages', JSON.stringify(messages));
    setSavedMessages(messages);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Save for later if checkbox is checked
    if (saveForLater && label.trim()) {
      const newMessage: SavedAwayMessage = {
        id: Date.now().toString(),
        label: label.trim(),
        message: message.trim()
      };
      persistMessages([...savedMessages, newMessage]);
    }

    onSave(message);
  };

  const selectSavedMessage = (saved: SavedAwayMessage) => {
    setMessage(saved.message);
    if (editorRef.current) {
      editorRef.current.innerHTML = saved.message;
    }
    setLabel(saved.label);
    setShowDropdown(false);
  };

  const deleteSavedMessage = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    persistMessages(savedMessages.filter(m => m.id !== id));
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-gray-300 w-full max-w-md border border-gray-500 shadow-xl">
        {/* Classic Windows Title Bar */}
        <div className="bg-gradient-to-r from-blue-800 to-blue-600 px-2 py-1 flex items-center justify-between">
          <span className="text-white text-sm font-bold">Edit Away Message</span>
          <button
            type="button"
            onClick={onClose}
            className="w-5 h-5 bg-gray-300 border border-gray-500 flex items-center justify-center text-black text-xs font-bold hover:bg-gray-200"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-3">
          {/* Enter label with dropdown */}
          <div className="flex items-center gap-2 mb-3">
            <label className="text-sm text-gray-800 whitespace-nowrap">Enter label:</label>
            <div className="relative flex-1" ref={dropdownRef}>
              <div
                className="w-full px-2 py-1 text-sm bg-white border border-gray-500 cursor-pointer flex items-center justify-between"
                onClick={() => setShowDropdown(!showDropdown)}
              >
                <span className={label ? 'text-gray-800' : 'text-gray-500'}>
                  {label || 'Select or type a label...'}
                </span>
                <span className="text-xs">▼</span>
              </div>
              {showDropdown && (
                <div className="absolute top-full left-0 right-0 bg-white border border-gray-500 max-h-32 overflow-y-auto z-10">
                  <input
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="w-full px-2 py-1 text-sm border-b border-gray-300 focus:outline-none"
                    placeholder="Type new label..."
                    autoFocus
                  />
                  {savedMessages.map((saved) => (
                    <div
                      key={saved.id}
                      className="px-2 py-1 text-sm hover:bg-blue-100 cursor-pointer flex items-center justify-between"
                      onClick={() => selectSavedMessage(saved)}
                    >
                      <span>{saved.label}</span>
                      <button
                        type="button"
                        onClick={(e) => deleteSavedMessage(saved.id, e)}
                        className="text-red-600 hover:text-red-800 text-xs px-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Enter new Away message label */}
          <label className="text-sm text-gray-800 block mb-1">Enter new Away message:</label>

          {/* Formatting Toolbar */}
          <div className="flex items-center gap-0.5 mb-1 bg-gray-200 border border-gray-400 p-0.5">
            {/* Bold */}
            <button type="button" onClick={() => applyFormat('bold')} className="w-6 h-6 border border-gray-400 bg-white text-xs font-bold hover:bg-gray-100" title="Bold">B</button>
            {/* Italic */}
            <button type="button" onClick={() => applyFormat('italic')} className="w-6 h-6 border border-gray-400 bg-white text-xs italic hover:bg-gray-100" title="Italic">I</button>
            {/* Underline */}
            <button type="button" onClick={() => applyFormat('underline')} className="w-6 h-6 border border-gray-400 bg-white text-xs underline hover:bg-gray-100" title="Underline">U</button>

            <div className="w-px h-5 bg-gray-400 mx-0.5" />

            {/* Smaller text */}
            <button type="button" onClick={() => applyFormat('fontSize', '2')} className="w-6 h-6 border border-gray-400 bg-white text-xs hover:bg-gray-100" title="Smaller text">A</button>
            {/* Larger text */}
            <button type="button" onClick={() => applyFormat('fontSize', '5')} className="w-6 h-6 border border-gray-400 bg-white text-sm hover:bg-gray-100" title="Larger text">A</button>

            <div className="w-px h-5 bg-gray-400 mx-0.5" />

            {/* Text Color */}
            <div className="relative" ref={colorPickerRef}>
              <button
                type="button"
                onClick={() => { setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); setShowEmojiPicker(false); }}
                className="w-6 h-6 border border-gray-400 bg-white text-xs hover:bg-gray-100 relative"
                title="Text color"
              >
                A
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500" />
              </button>
              {showColorPicker && (
                <div className="absolute bottom-7 left-0 bg-white border-2 border-gray-400 rounded p-1 flex gap-0.5 flex-wrap w-24 z-50 shadow-lg">
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => applyColor(color)}
                      className="w-4 h-4 rounded border border-gray-400 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Highlight Color */}
            <div className="relative" ref={highlightPickerRef}>
              <button
                type="button"
                onClick={() => { setShowHighlightPicker(!showHighlightPicker); setShowColorPicker(false); setShowEmojiPicker(false); }}
                className="w-6 h-6 border border-gray-400 bg-white hover:bg-gray-100 flex items-center justify-center"
                title="Highlight color"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" fill="#ffff00" stroke="currentColor" />
                </svg>
              </button>
              {showHighlightPicker && (
                <div className="absolute bottom-7 left-0 bg-white border-2 border-gray-400 rounded p-1 flex gap-0.5 z-50 shadow-lg">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => applyHighlight(color)}
                      className="w-4 h-4 rounded border border-gray-400 hover:scale-110 transition-transform"
                      style={{ backgroundColor: color === 'transparent' ? 'white' : color }}
                    >
                      {color === 'transparent' && <span className="text-[8px] text-gray-400">✕</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-px h-5 bg-gray-400 mx-0.5" />

            {/* Emoji */}
            <div className="relative" ref={emojiPickerRef}>
              <button
                type="button"
                onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowColorPicker(false); setShowHighlightPicker(false); }}
                className="w-6 h-6 border border-gray-400 bg-white text-sm hover:bg-gray-100"
                title="Insert emoji"
              >
                😊
              </button>
              {showEmojiPicker && (
                <div className="absolute bottom-7 right-0 bg-white border-2 border-gray-400 rounded shadow-lg w-56 max-h-48 overflow-hidden z-50">
                  <div className="flex overflow-x-auto border-b border-gray-300 p-1 gap-0.5 bg-gray-100">
                    {Object.keys(EMOJI_CATEGORIES).map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveEmojiCategory(category)}
                        className={`px-1.5 py-0.5 text-xs font-medium rounded whitespace-nowrap ${
                          activeEmojiCategory === category
                            ? 'bg-blue-100 text-blue-600 border border-gray-400'
                            : 'text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                  <div className="p-1.5 h-32 overflow-y-auto">
                    <div className="grid grid-cols-6 gap-0.5">
                      {EMOJI_CATEGORIES[activeEmojiCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="w-6 h-6 flex items-center justify-center text-base hover:bg-gray-100 rounded"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Message Text Area (contenteditable for formatting) */}
          <div className="relative">
            <div
              ref={editorRef}
              contentEditable
              onInput={handleInput}
              className="w-full px-2 py-1 text-sm bg-white border border-gray-500 text-gray-900 focus:outline-none min-h-[80px] max-h-[120px] overflow-y-auto"
              style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              data-placeholder="~*Be right back, reliving the '90s*~"
            />
            {!message && (
              <div className="absolute top-1 left-2 text-gray-400 text-sm pointer-events-none">
                ~*Be right back, reliving the '90s*~
              </div>
            )}
          </div>

          {/* Special Characters and Save for Later */}
          <div className="flex justify-between items-start mt-2">
            <div className="text-xs text-gray-700">
              <p className="font-semibold mb-0.5">Special Characters:</p>
              <p>%n = Screen Name of Buddy</p>
              <p>%d = Current date</p>
              <p>%t = Current time</p>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-800">Save for later use</span>
              <input
                type="checkbox"
                checked={saveForLater}
                onChange={(e) => setSaveForLater(e.target.checked)}
                className="w-4 h-4"
              />
            </div>
          </div>

          {/* Buttons */}
          <div className="flex justify-center gap-3 mt-4">
            <button
              type="submit"
              className="px-6 py-1 text-sm bg-gray-200 border-2 border-gray-400 hover:bg-gray-300"
            >
              I'm Away
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-1 text-sm bg-gray-200 border-2 border-gray-400 hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
