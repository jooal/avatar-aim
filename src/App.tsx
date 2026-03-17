import React, { useState, useEffect, useRef } from 'react';
import { supabase, Profile } from './lib/supabase';
import { User, RealtimeChannel } from '@supabase/supabase-js';
import { playSignOnSound, playSignOffSound, playMessageSound } from './utils/sounds';

// Sanitize HTML to prevent XSS while allowing formatting tags
function sanitizeHtml(html: string): string {
  // If it doesn't contain HTML tags, return as-is (plain text message)
  if (!/<[^>]+>/.test(html)) {
    return html;
  }

  const safeTags = ['b', 'strong', 'i', 'em', 'u', 'span', 'font', 'br', 'div', 'p'];
  const safeAttrs = ['color', 'size', 'face']; // Only allow font-related attributes

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
  }

  return doc.body.innerHTML;
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
  const [view, setView] = useState<'login' | 'signup'>('login');

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
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    setProfile(data);
    setLoading(false);

    // Set user online when they log in
    if (data) {
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
      <div className="min-h-screen bg-gray-300 flex items-center justify-center">
        <div className="text-gray-700 text-xl">Loading...</div>
      </div>
    );
  }

  // If this is a chat window, render the ChatWindow component
  if (conversationId && user) {
    return <ChatWindow conversationId={conversationId} user={user} profile={profile} />;
  }

  return (
    <div className="min-h-screen bg-gray-300">
      {!user ? (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-lg bg-yellow-400 shadow-lg mb-4 border-2 border-gray-400">
                <span className="text-4xl">👾</span>
              </div>
              <h1 className="text-3xl font-bold text-gray-800">Avatar AIM</h1>
              <p className="text-gray-600 mt-2">Chat. Play. Connect.</p>
            </div>

            <div className="bg-gray-200 rounded-lg p-6 border-2 border-gray-400 shadow-lg">
              {view === 'login' ? (
                <LoginForm onSwitch={() => setView('signup')} />
              ) : (
                <SignupForm onSwitch={() => setView('login')} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <BuddyList user={user} profile={profile} onLogout={handleLogout} setProfile={setProfile} />
      )}
    </div>
  );
}

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
          placeholder="Enter your email"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
          placeholder="Enter your password"
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 bg-gray-100 border-2 border-gray-400 text-gray-800 font-bold rounded hover:bg-gray-200 transition-all shadow disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
      <p className="text-center text-gray-600">
        Don't have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-blue-600 hover:underline">
          Sign up
        </button>
      </p>
    </form>
  );
}

function SignupForm({ onSwitch }: { onSwitch: () => void }) {
  const [screenName, setScreenName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
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
      options: { data: { screen_name: screenName } },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    if (data.user && !error) {
      if (!data.session) {
        // Email confirmation is required - profile will be created by database trigger
        setError('Account created! Please check your email to confirm, then sign in.');
        setLoading(false);
        onSwitch();
        return;
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 bg-red-100 border border-red-400 rounded text-red-700 text-sm">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Screen Name</label>
        <input
          type="text"
          value={screenName}
          onChange={(e) => setScreenName(e.target.value)}
          className="w-full px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
          placeholder="Choose a screen name"
          required
          minLength={3}
          maxLength={20}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
          placeholder="Enter your email"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
          placeholder="Create a password (min 6 characters)"
          required
          minLength={6}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-2 bg-gray-100 border-2 border-gray-400 text-gray-800 font-bold rounded hover:bg-gray-200 transition-all shadow disabled:opacity-50"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
      <p className="text-center text-gray-600">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-blue-600 hover:underline">
          Sign in
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

    // Subscribe to profile changes
    const channel = supabase
      .channel(`profile-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'profiles',
        filter: `id=eq.${user.id}`
      }, (payload) => {
        setFreshProfile(payload.new as Profile);
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
        document.title = otherParticipant.screen_name || 'Chat';
      } else {
        // Self-chat: show own name
        const selfParticipant = conversation.participants?.find(p => p.id === user.id);
        document.title = selfParticipant?.screen_name || freshProfile?.screen_name || 'Chat';
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
      <div className="h-screen bg-gray-200 flex items-center justify-center">
        <div className="text-gray-600">Loading chat...</div>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="h-screen bg-gray-200 flex items-center justify-center">
        <div className="text-gray-600">Conversation not found</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
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
  const [showCreateGroup, setShowCreateGroup] = useState(false);
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

  // Close avatar picker when clicking outside
  useEffect(() => {
    if (!showAvatarPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (avatarPickerRef.current && !avatarPickerRef.current.contains(e.target as Node)) {
        setShowAvatarPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAvatarPicker]);

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

      // Set new timer
      inactivityTimerRef.current = setTimeout(() => {
        // Only auto-away if user is currently online
        if (profileStatusRef.current === 'online') {
          updateStatus('away', 'Auto-away: Inactive');
          wasAutoAwayRef.current = true;
        }
      }, AUTO_AWAY_TIMEOUT);
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
    <div className="h-screen bg-gray-200 flex flex-col">
        {/* User Profile Header */}
        <div className="p-4 border-b-2 border-gray-400 bg-gray-300">
          <div className="flex items-center gap-3">
            <div className="relative" ref={avatarPickerRef}>
              <button
                onClick={() => setShowAvatarPicker(!showAvatarPicker)}
                className="w-12 h-12 rounded bg-green-400 border-2 border-gray-500 flex items-center justify-center text-xl hover:border-gray-700 hover:bg-green-300 transition-colors cursor-pointer"
                title="Change avatar"
              >
                {profile?.avatar_url || '👾'}
              </button>
              <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-gray-300 ${getStatusColor(profile?.status as Status)}`} />
              {showAvatarPicker && (
                <div className="absolute top-14 left-0 z-50 bg-white border-2 border-gray-400 rounded-lg shadow-lg p-2 w-40">
                  <p className="text-xs text-gray-500 font-semibold mb-1 px-1">Choose Avatar</p>
                  <div className="grid grid-cols-3 gap-1">
                    {AVATAR_OPTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => updateAvatar(emoji)}
                        className={`w-10 h-10 rounded flex items-center justify-center text-xl hover:bg-yellow-100 transition-colors ${
                          profile?.avatar_url === emoji ? 'bg-yellow-200 border-2 border-yellow-500' : 'bg-gray-50 border border-gray-200'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex-1">
              <h3 className="text-gray-800 font-semibold">{profile?.screen_name}</h3>
              <select
                value={profile?.status || 'online'}
                onChange={(e) => handleStatusChange(e.target.value as Status)}
                className="text-sm bg-transparent text-gray-600 border-none focus:outline-none cursor-pointer"
              >
                <option value="online" className="bg-white">Online</option>
                <option value="away" className="bg-white">Away</option>
                <option value="offline" className="bg-white">Invisible</option>
              </select>
              {profile?.status === 'away' && (
                <button
                  onClick={() => setShowAwayMessage(true)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  Edit away msg
                </button>
              )}
            </div>
            <button
              onClick={onLogout}
              className="p-2 text-gray-500 hover:text-gray-800 transition-colors"
              title="Sign Out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="p-3 space-y-2">
            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddFriend(true)}
                className="flex-1 py-2 px-3 bg-gray-100 border-2 border-gray-400 text-gray-700 rounded hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                + Add Buddy
              </button>
              <button
                onClick={() => setShowCreateGroup(true)}
                className="flex-1 py-2 px-3 bg-gray-100 border-2 border-gray-400 text-gray-700 rounded hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                + Group Chat
              </button>
            </div>
            {pendingRequests.length > 0 && (
              <div className="text-xs text-red-500 font-medium px-1">
                {pendingRequests.length} pending request{pendingRequests.length > 1 ? 's' : ''}
              </div>
            )}

              {loadingFriends ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500"></div>
                </div>
              ) : (
                <>
                  {/* Pending Requests */}
                  {pendingRequests.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs uppercase text-gray-500 font-semibold mb-2 px-2">Friend Requests</h4>
                      {pendingRequests.map((request) => (
                        <FriendRequestItem key={request.id} request={request} onUpdate={loadFriends} />
                      ))}
                    </div>
                  )}

                  {/* Buddies List - Online */}
                  <div className="mt-4">
                    <button
                      onClick={() => setBuddiesCollapsed(!buddiesCollapsed)}
                      className="flex items-center gap-1 text-xs uppercase text-gray-500 font-semibold mb-2 px-2 hover:text-gray-700 w-full text-left"
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${buddiesCollapsed ? '' : 'rotate-90'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      Buddies ({friends.filter(f => f.profile?.status === 'online' || f.profile?.status === 'away').length + (profile?.status === 'online' || profile?.status === 'away' ? 1 : 0)}/{friends.length + 1})
                    </button>
                    {!buddiesCollapsed && (
                      <>
                        {/* Self - current user */}
                        {profile && (profile.status === 'online' || profile.status === 'away') && (
                          <button
                            onClick={() => startDirectMessage(user.id)}
                            className="w-full py-1 px-4 hover:bg-gray-100 transition-colors text-left"
                          >
                            <span className={`text-sm ${profile.status === 'away' ? 'text-gray-400' : 'text-gray-800'}`}>
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
                              onMessage={() => friend.profile && startDirectMessage(friend.profile.id)}
                              getStatusColor={getStatusColor}
                              disabled={false}
                              recentlySignedOn={!!friend.profile && recentlySignedOn.has(friend.profile.id)}
                            />
                          ))
                        }
                        {friends.length === 0 && !(profile?.status === 'online' || profile?.status === 'away') && (
                          <p className="text-gray-500 text-sm px-2">No buddies yet. Add some!</p>
                        )}
                      </>
                    )}
                  </div>

                  {/* Groups List */}
                  <div className="mt-4">
                    <button
                      onClick={() => setGroupsCollapsed(!groupsCollapsed)}
                      className="flex items-center gap-1 text-xs uppercase text-gray-500 font-semibold mb-2 px-2 hover:text-gray-700 w-full text-left"
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${groupsCollapsed ? '' : 'rotate-90'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      Groups ({conversations.filter(c => c.is_group).length})
                    </button>
                    {!groupsCollapsed && (
                      conversations.filter(c => c.is_group).length === 0 ? (
                        <p className="text-gray-400 text-sm px-4">No groups yet</p>
                      ) : (
                        conversations
                          .filter(c => c.is_group)
                          .map((convo) => (
                            <button
                              key={convo.id}
                              onClick={() => window.electronAPI?.openChatWindow(convo.id, convo.name || 'Group Chat')}
                              className="w-full py-1 px-4 hover:bg-gray-100 transition-colors text-left"
                            >
                              <span className="text-sm text-gray-800">
                                {convo.name || 'Group Chat'}
                              </span>
                            </button>
                          ))
                      )
                    )}
                  </div>

                  {/* Buddies List - Offline */}
                  <div className="mt-4">
                    <button
                      onClick={() => setOfflineCollapsed(!offlineCollapsed)}
                      className="flex items-center gap-1 text-xs uppercase text-gray-500 font-semibold mb-2 px-2 hover:text-gray-700 w-full text-left"
                    >
                      <svg
                        className={`w-3 h-3 transition-transform ${offlineCollapsed ? '' : 'rotate-90'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      Offline ({friends.filter(f => f.profile?.status === 'offline' || !f.profile?.status).length + (profile?.status === 'offline' || !profile?.status ? 1 : 0)}/{friends.length + 1})
                    </button>
                    {!offlineCollapsed && (
                      <>
                        {/* Self - current user if offline */}
                        {profile && (profile.status === 'offline' || !profile.status) && (
                          <button
                            onClick={() => startDirectMessage(user.id)}
                            className="w-full py-1 px-4 hover:bg-gray-100 transition-colors text-left"
                          >
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
                              onMessage={() => friend.profile && startDirectMessage(friend.profile.id)}
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
    <div className="flex items-center gap-3 p-2 rounded bg-yellow-50 border border-yellow-400">
      <div className="w-10 h-10 rounded bg-yellow-400 border border-gray-400 flex items-center justify-center">
        {request.profile?.avatar_url || '👾'}
      </div>
      <div className="flex-1">
        <p className="text-gray-800 text-sm font-medium">{request.profile?.screen_name}</p>
        <p className="text-gray-500 text-xs">Wants to be friends</p>
      </div>
      <div className="flex gap-1">
        <button
          onClick={handleAccept}
          className="p-1.5 bg-green-100 text-green-600 rounded border border-green-400 hover:bg-green-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          onClick={handleDecline}
          className="p-1.5 bg-red-100 text-red-600 rounded border border-red-400 hover:bg-red-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
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

  return (
    <button
      onClick={onMessage}
      disabled={disabled}
      className="w-full py-1 px-4 hover:bg-gray-100 transition-colors text-left disabled:opacity-50 disabled:cursor-wait flex items-center justify-between"
    >
      <span className={`text-sm ${isAway ? 'text-gray-400' : 'text-gray-800'}`}>
        {friend.profile?.screen_name}
      </span>
      {recentlySignedOn && (
        <span className="text-lg flex-shrink-0" title="Just signed on!">
          🚪
        </span>
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
  const typingRemovalTimeouts = useRef<Set<NodeJS.Timeout>>(new Set());
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
  }, [messages, awayMessages]);

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

          // Remove typing indicator after 3 seconds
          const timeout = setTimeout(() => {
            setTypingUsers(prev => prev.filter(name => name !== payload.screenName));
            typingRemovalTimeouts.current.delete(timeout);
          }, 3000);
          typingRemovalTimeouts.current.add(timeout);
        }
      })
      .on('broadcast', { event: 'stop_typing' }, ({ payload }) => {
        if (payload.userId !== currentUserId) {
          setTypingUsers(prev => prev.filter(name => name !== payload.screenName));
        }
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

    // After sending, check if any participants are away and trigger their away message
    // Use a timestamp slightly in the future so it sorts after the sent message
    const awayTimestamp = new Date(Date.now() + 1000).toISOString();
    const newAwayMessages: AwayMessageEntry[] = [];

    // Check other participants for away messages
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
      // Small delay to ensure the sent message arrives via realtime first
      setTimeout(() => {
        setAwayMessages(prev => [...prev, ...newAwayMessages]);
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
    <>
      {/* Main content area - 2 row grid for perfect 50/50 split */}
      <div className="flex-1 grid grid-rows-2 overflow-hidden">
        {/* TOP ROW: Top avatar + Messages */}
        <div className="flex min-h-0">
          {/* Top avatar banner */}
          <div className="w-24 flex-shrink-0 border-r-2 border-gray-400 bg-gray-400 pt-1 pl-1 pr-1 pb-0.5">
            {(isSelfChat ? [profile] : otherParticipants).filter(Boolean).slice(0, 1).map((participant, idx) => (
              <div key={participant?.id || idx} className="h-full flex items-center justify-center p-2 bg-blue-600"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M10 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-4 2c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm8 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm-4 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6 1c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm-12 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm6 5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-4 2c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm8 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1z' fill='%233b82f6' fill-opacity='0.4'/%3E%3C/svg%3E")`,
                }}>
                <div className="w-16 h-16 rounded-lg bg-yellow-400 border-2 border-yellow-600 flex items-center justify-center text-3xl shadow-lg">
                  {participant?.avatar_url || '👾'}
                </div>
              </div>
            ))}
          </div>
          {/* Messages area */}
          <div className="flex-1 min-w-0 overflow-y-auto p-4 bg-white">
        {loadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-500 mx-auto mb-3"></div>
              <p className="text-gray-500 text-sm">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 && awayMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">No messages yet. Say hello!</p>
          </div>
        ) : (
          <div className="space-y-1">
            {/* Combine and sort messages with away messages by timestamp */}
            {(() => {
              // Create unified list of all messages
              const allItems: Array<{type: 'message' | 'away', data: Message | AwayMessageEntry, timestamp: string}> = [
                ...messages.map(m => ({ type: 'message' as const, data: m, timestamp: m.created_at })),
                ...awayMessages.map(a => ({ type: 'away' as const, data: a, timestamp: a.timestamp }))
              ];
              // Sort by timestamp
              allItems.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

              return allItems.map((item) => {
                if (item.type === 'away') {
                  const awayMsg = item.data as AwayMessageEntry;
                  // Process special characters: %n = viewer's name, %d = date, %t = time
                  const processedContent = processAwayMessageSpecialChars(
                    awayMsg.content,
                    profile?.screen_name
                  );
                  return (
                    <div key={awayMsg.id} className="flex justify-start">
                      <div className="leading-relaxed max-w-[80%] text-left">
                        <span className="font-bold text-blue-600">
                          {awayMsg.senderName} (away message):
                        </span>{' '}
                        <span
                          className="text-gray-800"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(processedContent) }}
                        />
                      </div>
                    </div>
                  );
                } else {
                  const message = item.data as Message;
                  const isOwn = message.sender_id === currentUserId;
                  const screenName = message.sender?.screen_name || (isOwn ? profile?.screen_name : 'Unknown');
                  return (
                    <div key={message.id} className="flex justify-start">
                      <div className="leading-relaxed max-w-[80%] text-left">
                        <span className={`font-bold ${isOwn ? 'text-red-600' : 'text-blue-600'}`}>
                          {screenName}:
                        </span>{' '}
                        <span
                          className="text-gray-800"
                          dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.content) }}
                        />
                      </div>
                    </div>
                  );
                }
              });
            })()}
          </div>
        )}
          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* BOTTOM ROW: Bottom avatar + Input area */}
        <div className="flex min-h-0">
          {/* Bottom avatar banner */}
          <div className="w-24 flex-shrink-0 border-r-2 border-gray-400 bg-gray-400 pt-0.5 pl-1 pr-1 pb-1">
            <div className="h-full flex items-center justify-center p-2 bg-blue-600"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='20' height='20' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M10 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-4 2c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm8 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm-4 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6 1c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm-12 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm6 5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-4 2c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1zm8 0c.55 0 1-.45 1-1s-.45-1-1-1-1 .45-1 1 .45 1 1 1z' fill='%233b82f6' fill-opacity='0.4'/%3E%3C/svg%3E")`,
              }}>
              <div className="w-16 h-16 rounded-lg bg-green-400 border-2 border-green-600 flex items-center justify-center text-3xl shadow-lg">
                {profile?.avatar_url || '👾'}
              </div>
            </div>
          </div>
          {/* Input area */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Typing Indicator */}
            {typingUsers.length > 0 && (
              <div className="px-4 py-2 border-b border-gray-300 bg-gray-100">
                <div className="flex items-center gap-2 text-gray-500 text-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </div>
                  <span>
                    {typingUsers.length === 1
                      ? `${typingUsers[0]} is typing...`
                      : `${typingUsers.join(', ')} are typing...`}
                  </span>
                </div>
              </div>
            )}

            {/* Message Input - fills remaining space */}
            <MessageInput
              value={newMessage}
              onChange={handleInputChange}
              onSend={handleSend}
              sending={sending}
            />
          </div>
        </div>
      </div>
    </>
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
    <div className="h-full flex flex-col bg-gray-200">
      {/* Formatting Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-300 bg-gray-300">
        {/* Bold */}
        <button
          type="button"
          onClick={() => applyFormat('bold')}
          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded font-bold transition-colors border border-gray-400"
          title="Bold (Ctrl+B)"
        >
          B
        </button>
        {/* Italic */}
        <button
          type="button"
          onClick={() => applyFormat('italic')}
          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded italic transition-colors border border-gray-400"
          title="Italic (Ctrl+I)"
        >
          I
        </button>
        {/* Underline */}
        <button
          type="button"
          onClick={() => applyFormat('underline')}
          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded underline transition-colors border border-gray-400"
          title="Underline (Ctrl+U)"
        >
          U
        </button>

        <div className="w-px h-5 bg-gray-400 mx-1" />

        {/* Font Size Smaller */}
        <button
          type="button"
          onClick={() => applyFormat('fontSize', '2')}
          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded text-xs transition-colors border border-gray-400"
          title="Smaller text"
        >
          A
        </button>
        {/* Font Size Larger */}
        <button
          type="button"
          onClick={() => applyFormat('fontSize', '5')}
          className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded text-lg transition-colors border border-gray-400"
          title="Larger text"
        >
          A
        </button>

        <div className="w-px h-5 bg-gray-400 mx-1" />

        {/* Text Color */}
        <div className="relative color-picker-container">
          <button
            type="button"
            onClick={() => { setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); }}
            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors border border-gray-400"
            title="Text color"
          >
            <span className="text-sm">A</span>
            <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-4 h-1 bg-gradient-to-r from-red-500 via-yellow-500 to-blue-500 rounded-full" />
          </button>
          {showColorPicker && (
            <div className="absolute bottom-10 left-0 bg-white border-2 border-gray-400 rounded p-2 flex gap-1 flex-wrap w-28 z-50 shadow-lg">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => { applyFormat('foreColor', color); setShowColorPicker(false); }}
                  className="w-5 h-5 rounded border border-gray-400 hover:scale-110 transition-transform"
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
            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-gray-900 hover:bg-gray-200 rounded transition-colors border border-gray-400"
            title="Highlight color"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M4 2a2 2 0 00-2 2v11a3 3 0 106 0V4a2 2 0 00-2-2H4zm1 14a1 1 0 100-2 1 1 0 000 2zm5-1.757l4.9-4.9a2 2 0 000-2.828L13.485 5.1a2 2 0 00-2.828 0L10 5.757v8.486zM16 18H9.071l6-6H16a2 2 0 012 2v2a2 2 0 01-2 2z" clipRule="evenodd" />
            </svg>
          </button>
          {showHighlightPicker && (
            <div className="absolute bottom-10 left-0 bg-white border-2 border-gray-400 rounded p-2 flex gap-1 z-50 shadow-lg">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => { applyFormat('hiliteColor', color); setShowHighlightPicker(false); }}
                  className="w-5 h-5 rounded border border-gray-400 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color === 'transparent' ? 'white' : color }}
                >
                  {color === 'transparent' && <span className="text-xs text-gray-400">✕</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-gray-400 mx-1" />

        {/* Emoji Picker */}
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="w-8 h-8 flex items-center justify-center text-gray-600 hover:text-yellow-600 transition-colors rounded hover:bg-gray-200 border border-gray-400"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {showEmojiPicker && (
            <div className="absolute bottom-full left-0 mb-1 bg-white border-2 border-gray-400 rounded shadow-lg w-56 max-h-48 overflow-hidden z-50">
              <div className="flex overflow-x-auto border-b border-gray-300 p-1 gap-0.5 bg-gray-100 scrollbar-thin">
                {Object.keys(EMOJI_CATEGORIES).map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`px-1.5 py-0.5 text-[10px] font-medium rounded whitespace-nowrap transition-colors ${
                      activeCategory === category
                        ? 'bg-blue-100 text-blue-600 border border-gray-400'
                        : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
              <div className="p-1.5 h-32 overflow-y-auto overflow-x-auto">
                <div className="grid grid-cols-6 gap-0.5">
                  {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="w-6 h-6 flex items-center justify-center text-base hover:bg-gray-100 rounded transition-colors"
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
      <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-3">
        <div className="flex-1 flex gap-3 items-stretch">
          <div
            ref={editorRef}
            contentEditable
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            className="flex-1 px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-800 focus:outline-none focus:border-gray-500 overflow-y-auto"
            style={{ wordBreak: 'break-word' }}
            data-placeholder="Type a message..."
          />
          <button
            type="submit"
            disabled={sending}
            className="px-6 py-2 bg-gray-100 border-2 border-gray-400 text-gray-800 font-bold rounded hover:bg-gray-200 transition-all disabled:opacity-50 self-end"
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
      <div className="bg-gray-200 rounded-lg p-6 w-full max-w-md border-2 border-gray-400 shadow-xl">
        <h2 className="text-xl font-bold text-gray-800 mb-4">Add Friend</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-100 border border-red-400 rounded text-red-700 text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Screen Name</label>
            <input
              type="text"
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              className="w-full px-3 py-2 rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
              placeholder="Enter friend's screen name"
              required
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 bg-gray-100 border-2 border-gray-400 text-gray-700 rounded hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-gray-100 border-2 border-gray-400 text-gray-800 font-bold rounded hover:bg-gray-200 transition-all disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send Request'}
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
      <div className="bg-gray-200 rounded-lg p-4 w-full max-w-sm border-2 border-gray-400 shadow-xl">
        <h2 className="text-base font-bold text-gray-800 mb-3">Create Group Chat</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Group Name</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm rounded border-2 border-gray-400 bg-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-gray-500"
              placeholder="Enter group name"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Select Friends</label>
            <div className="space-y-1 max-h-40 overflow-y-auto bg-white border-2 border-gray-400 rounded p-1.5">
              {friends.length === 0 ? (
                <p className="text-gray-500 text-xs p-1">Add some friends first!</p>
              ) : (
                friends.filter(f => f.profile).map((friend) => {
                  const friendId = friend.profile!.id;
                  return (
                    <label
                      key={friend.id}
                      className={`flex items-center gap-2 p-1.5 rounded cursor-pointer transition-colors ${
                        selectedFriends.includes(friendId)
                          ? 'bg-blue-100 border border-gray-400'
                          : 'hover:bg-gray-100 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedFriends.includes(friendId)}
                        onChange={() => toggleFriend(friendId)}
                        className="hidden"
                      />
                      <div className="w-6 h-6 rounded bg-blue-300 border border-gray-400 flex items-center justify-center text-xs">
                        {friend.profile?.avatar_url || '👾'}
                      </div>
                      <span className="text-sm text-gray-800">{friend.profile?.screen_name}</span>
                      {selectedFriends.includes(friendId) && (
                        <svg className="w-4 h-4 text-blue-600 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-1.5 text-sm bg-gray-100 border-2 border-gray-400 text-gray-700 rounded hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || selectedFriends.length === 0 || !groupName.trim()}
              className="flex-1 py-1.5 text-sm bg-gray-100 border-2 border-gray-400 text-gray-800 font-medium rounded hover:bg-gray-200 transition-all disabled:opacity-50"
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
            <button type="button" onClick={() => applyFormat('fontSize', '2')} className="w-6 h-6 border border-gray-400 bg-white text-[10px] hover:bg-gray-100" title="Smaller text">A</button>
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
                        className={`px-1.5 py-0.5 text-[10px] font-medium rounded whitespace-nowrap ${
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
