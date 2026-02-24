import React, { useState, useEffect, useRef } from 'react';
import { supabase, Profile } from './lib/supabase';
import { User, RealtimeChannel } from '@supabase/supabase-js';

type Status = 'online' | 'away' | 'offline';

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
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-800">
      {!user ? (
        <div className="flex items-center justify-center min-h-screen p-4">
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-yellow-400 to-orange-500 shadow-2xl mb-4">
                <span className="text-4xl">👾</span>
              </div>
              <h1 className="text-3xl font-bold text-white">Avatar AIM</h1>
              <p className="text-purple-200 mt-2">Chat. Play. Connect.</p>
            </div>

            <div className="bg-white/10 backdrop-blur-xl rounded-3xl p-8 border border-white/20 shadow-2xl">
              {view === 'login' ? (
                <LoginForm onSwitch={() => setView('signup')} />
              ) : (
                <SignupForm onSwitch={() => setView('login')} />
              )}
            </div>
          </div>
        </div>
      ) : (
        <MainChat user={user} profile={profile} onLogout={handleLogout} setProfile={setProfile} />
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-purple-200 mb-2">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          placeholder="Enter your email"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-purple-200 mb-2">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          placeholder="Enter your password"
          required
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 font-bold rounded-xl hover:from-yellow-300 hover:to-orange-400 transition-all shadow-lg disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>
      <p className="text-center text-purple-200">
        Don't have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-yellow-400 hover:underline">
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
      const { error: profileError } = await supabase
        .from('profiles')
        .upsert({ id: data.user.id, screen_name: screenName, email: email });

      if (profileError) {
        setError('Account created but profile setup failed: ' + profileError.message);
        setLoading(false);
        return;
      }

      if (!data.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          setError('Account created! Please check your email to confirm, then sign in.');
          setLoading(false);
          onSwitch();
          return;
        }
      }
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
          {error}
        </div>
      )}
      <div>
        <label className="block text-sm font-medium text-purple-200 mb-2">Screen Name</label>
        <input
          type="text"
          value={screenName}
          onChange={(e) => setScreenName(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          placeholder="Choose a screen name"
          required
          minLength={3}
          maxLength={20}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-purple-200 mb-2">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          placeholder="Enter your email"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-purple-200 mb-2">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-purple-300 focus:outline-none focus:ring-2 focus:ring-yellow-400"
          placeholder="Create a password (min 6 characters)"
          required
          minLength={6}
        />
      </div>
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 font-bold rounded-xl hover:from-yellow-300 hover:to-orange-400 transition-all shadow-lg disabled:opacity-50"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>
      <p className="text-center text-purple-200">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="text-yellow-400 hover:underline">
          Sign in
        </button>
      </p>
    </form>
  );
}

function MainChat({ user, profile, onLogout, setProfile }: {
  user: User;
  profile: Profile | null;
  onLogout: () => void;
  setProfile: (p: Profile | null) => void;
}) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Friend[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [showAddFriend, setShowAddFriend] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [tab, setTab] = useState<'friends' | 'chats'>('friends');
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [openingChat, setOpeningChat] = useState(false);

  useEffect(() => {
    loadFriends();
    loadConversations();

    // Subscribe to realtime updates
    const friendsChannel = supabase
      .channel('friends-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friends' }, () => {
        loadFriends();
      })
      .subscribe();

    const profilesChannel = supabase
      .channel('profiles-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, () => {
        loadFriends();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(friendsChannel);
      supabase.removeChannel(profilesChannel);
    };
  }, [user.id]);

  useEffect(() => {
    if (!activeConversation) return;

    loadMessages(activeConversation.id);

    const channel = supabase
      .channel(`messages-${activeConversation.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${activeConversation.id}`
      }, async (payload) => {
        const newMessage = payload.new as Message;
        // Fetch sender profile for the new message
        const { data: senderProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', newMessage.sender_id)
          .single();

        setMessages(prev => [...prev, { ...newMessage, sender: senderProfile }]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversation?.id]);

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

  async function loadMessages(conversationId: string) {
    setLoadingMessages(true);
    try {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });

      if (data && data.length > 0) {
        const senderIds = [...new Set(data.map(m => m.sender_id))];

        // Fetch all sender profiles
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', senderIds);

        const messagesWithSenders = data.map(m => ({
          ...m,
          sender: profiles?.find(p => p.id === m.sender_id) || null
        }));
        setMessages(messagesWithSenders);
      } else {
        setMessages([]);
      }
    } finally {
      setLoadingMessages(false);
    }
  }

  async function startDirectMessage(friendId: string) {
    setOpeningChat(true);
    try {
      // Check database for existing DM conversation with this friend
      const { data: myConvos } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id);

      if (myConvos && myConvos.length > 0) {
        const myConvoIds = myConvos.map(c => c.conversation_id);

        // Find conversations where friend is also a participant
        const { data: sharedConvos } = await supabase
          .from('conversation_participants')
          .select('conversation_id')
          .eq('user_id', friendId)
          .in('conversation_id', myConvoIds);

        if (sharedConvos && sharedConvos.length > 0) {
          // Check if any of these are DMs (not groups)
          const { data: dmConvo } = await supabase
            .from('conversations')
            .select('*')
            .eq('id', sharedConvos[0].conversation_id)
            .eq('is_group', false)
            .single();

          if (dmConvo) {
            // Get participants for existing convo
            const { data: friendProfile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', friendId)
              .single();

            const existingConvo: Conversation = {
              ...dmConvo,
              participants: [profile, friendProfile].filter(Boolean) as Profile[]
            };

            setActiveConversation(existingConvo);
            setTab('chats');
            await loadConversations();
            return;
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
        // Add both participants
        await supabase.from('conversation_participants').insert([
          { conversation_id: convo.id, user_id: user.id },
          { conversation_id: convo.id, user_id: friendId }
        ]);

        // Get friend's profile for the conversation
        const { data: friendProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', friendId)
          .single();

        // Set the new conversation as active immediately
        const newConvo: Conversation = {
          ...convo,
          participants: [profile, friendProfile].filter(Boolean) as Profile[]
        };

        setActiveConversation(newConvo);
        setConversations(prev => [...prev, newConvo]);
        setTab('chats');
      }
    } finally {
      setOpeningChat(false);
    }
  }

  async function updateStatus(status: Status) {
    await supabase
      .from('profiles')
      .update({ status })
      .eq('id', user.id);

    if (profile) {
      setProfile({ ...profile, status });
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
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-80 bg-gray-900/50 backdrop-blur-xl border-r border-white/10 flex flex-col">
        {/* User Profile Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-xl">
                👾
              </div>
              <div className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-gray-900 ${getStatusColor(profile?.status as Status)}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-white font-semibold">{profile?.screen_name}</h3>
              <select
                value={profile?.status || 'online'}
                onChange={(e) => updateStatus(e.target.value as Status)}
                className="text-sm bg-transparent text-purple-300 border-none focus:outline-none cursor-pointer"
              >
                <option value="online" className="bg-gray-900">Online</option>
                <option value="away" className="bg-gray-900">Away</option>
                <option value="offline" className="bg-gray-900">Offline</option>
              </select>
            </div>
            <button
              onClick={onLogout}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              title="Sign Out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setTab('friends')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'friends' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            Friends {pendingRequests.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-red-500 rounded-full text-xs text-white">{pendingRequests.length}</span>}
          </button>
          <button
            onClick={() => setTab('chats')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === 'chats' ? 'text-yellow-400 border-b-2 border-yellow-400' : 'text-gray-400 hover:text-white'
            }`}
          >
            Chats
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'friends' ? (
            <div className="p-3 space-y-2">
              {/* Add Friend Button */}
              <button
                onClick={() => setShowAddFriend(true)}
                className="w-full py-2 px-4 bg-yellow-500/20 border border-yellow-500/50 text-yellow-400 rounded-xl hover:bg-yellow-500/30 transition-colors text-sm font-medium"
              >
                + Add Friend
              </button>

              {loadingFriends ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400"></div>
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

                  {/* Friends List */}
                  <div className="mt-4">
                    <h4 className="text-xs uppercase text-gray-500 font-semibold mb-2 px-2">Friends ({friends.length})</h4>
                    {friends.length === 0 ? (
                      <p className="text-gray-500 text-sm px-2">No friends yet. Add some!</p>
                    ) : (
                      friends.map((friend) => (
                        <FriendItem
                          key={friend.id}
                          friend={friend}
                          onMessage={() => startDirectMessage(friend.profile!.id)}
                          getStatusColor={getStatusColor}
                          disabled={openingChat}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="p-3 space-y-2">
              <button
                onClick={() => setShowCreateGroup(true)}
                className="w-full py-2 px-4 bg-purple-500/20 border border-purple-500/50 text-purple-400 rounded-xl hover:bg-purple-500/30 transition-colors text-sm font-medium"
              >
                + Create Group Chat
              </button>

              {loadingConversations ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400"></div>
                </div>
              ) : (
                <div className="mt-4 space-y-1">
                  {conversations.length === 0 ? (
                    <p className="text-gray-500 text-sm px-2">No conversations yet. Start chatting!</p>
                  ) : (
                    conversations.map((convo) => (
                      <ConversationItem
                        key={convo.id}
                        conversation={convo}
                        currentUserId={user.id}
                        isActive={activeConversation?.id === convo.id}
                        onClick={() => setActiveConversation(convo)}
                        getStatusColor={getStatusColor}
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {openingChat ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-400 mx-auto mb-4"></div>
              <p className="text-gray-400">Opening chat...</p>
            </div>
          </div>
        ) : activeConversation ? (
          <ChatArea
            conversation={activeConversation}
            messages={messages}
            currentUserId={user.id}
            profile={profile}
            loadingMessages={loadingMessages}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="text-6xl mb-4">💬</div>
              <p>Select a conversation to start chatting</p>
            </div>
          </div>
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
    <div className="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-yellow-500/30">
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center">
        👾
      </div>
      <div className="flex-1">
        <p className="text-white text-sm font-medium">{request.profile?.screen_name}</p>
        <p className="text-gray-400 text-xs">Wants to be friends</p>
      </div>
      <div className="flex gap-1">
        <button
          onClick={handleAccept}
          className="p-1.5 bg-green-500/20 text-green-400 rounded-lg hover:bg-green-500/30"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          onClick={handleDecline}
          className="p-1.5 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function FriendItem({ friend, onMessage, getStatusColor, disabled }: {
  friend: Friend;
  onMessage: () => void;
  getStatusColor: (status: Status | undefined) => string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onMessage}
      disabled={disabled}
      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors text-left disabled:opacity-50 disabled:cursor-wait"
    >
      <div className="relative">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center">
          👾
        </div>
        <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-900 ${getStatusColor(friend.profile?.status as Status)}`} />
      </div>
      <div className="flex-1">
        <p className="text-white text-sm font-medium">{friend.profile?.screen_name}</p>
        <p className="text-gray-400 text-xs capitalize">{friend.profile?.status || 'offline'}</p>
      </div>
      <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    </button>
  );
}

function ConversationItem({ conversation, currentUserId, isActive, onClick, getStatusColor }: {
  conversation: Conversation;
  currentUserId: string;
  isActive: boolean;
  onClick: () => void;
  getStatusColor: (status: Status | undefined) => string;
}) {
  const otherParticipants = conversation.participants?.filter(p => p.id !== currentUserId) || [];
  const displayName = conversation.is_group
    ? conversation.name || 'Group Chat'
    : otherParticipants[0]?.screen_name || 'Unknown';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-xl transition-colors text-left ${
        isActive ? 'bg-yellow-500/20 border border-yellow-500/50' : 'hover:bg-white/5'
      }`}
    >
      <div className="relative">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          conversation.is_group
            ? 'bg-gradient-to-br from-purple-500 to-pink-500'
            : 'bg-gradient-to-br from-blue-400 to-cyan-500'
        }`}>
          {conversation.is_group ? '👥' : '👾'}
        </div>
        {!conversation.is_group && (
          <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-gray-900 ${getStatusColor(otherParticipants[0]?.status as Status)}`} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{displayName}</p>
        {conversation.is_group && (
          <p className="text-gray-400 text-xs">{conversation.participants?.length || 0} members</p>
        )}
      </div>
    </button>
  );
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const otherParticipants = conversation.participants?.filter(p => p.id !== currentUserId) || [];
  const displayName = conversation.is_group
    ? conversation.name || 'Group Chat'
    : otherParticipants[0]?.screen_name || 'Unknown';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
    console.log('[App] Loading hangout participants for conversation:', conversation.id);
    const { data, error } = await supabase
      .from('hangout_sessions')
      .select('*')
      .eq('conversation_id', conversation.id);

    console.log('[App] Hangout sessions data:', data, 'error:', error);

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

      console.log('[App] Participants with profiles:', participantsWithProfiles);
      setHangoutParticipants(participantsWithProfiles);
      setIsInHangout(data.some(h => h.user_id === currentUserId));

      // If user is in hangout, open the overlay window
      if (data.some(h => h.user_id === currentUserId)) {
        console.log('[App] Opening hangout window with participants:', participantsWithProfiles);
        window.electronAPI?.openHangoutWindow?.(conversation.id, participantsWithProfiles);
      }
    }
  }

  async function joinHangout() {
    setJoiningHangout(true);
    console.log('[App] Joining hangout for conversation:', conversation.id, 'user:', currentUserId);
    try {
      const { data, error } = await supabase.from('hangout_sessions').insert({
        conversation_id: conversation.id,
        user_id: currentUserId,
        avatar_x: 100 + Math.random() * 200,
        avatar_y: 100 + Math.random() * 100
      }).select();

      console.log('[App] Join hangout result:', data, 'error:', error);

      if (error) {
        console.error('[App] Failed to join hangout:', error);
      } else {
        setIsInHangout(true);
        // Manually load participants after joining
        await loadHangoutParticipants();
      }
    } catch (error) {
      console.error('[App] Failed to join hangout:', error);
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
    window.electronAPI?.closeHangoutWindow?.();
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
          setTimeout(() => {
            setTypingUsers(prev => prev.filter(name => name !== payload.screenName));
          }, 3000);
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
    await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender_id: currentUserId,
      content: newMessage.trim()
    });

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
      {/* Chat Header */}
      <div className="p-4 border-b border-white/10 bg-gray-900/30">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
            conversation.is_group
              ? 'bg-gradient-to-br from-purple-500 to-pink-500'
              : 'bg-gradient-to-br from-blue-400 to-cyan-500'
          }`}>
            {conversation.is_group ? '👥' : '👾'}
          </div>
          <div className="flex-1">
            <h2 className="text-white font-semibold">{displayName}</h2>
            {conversation.is_group && (
              <p className="text-gray-400 text-sm">
                {conversation.participants?.map(p => p.screen_name).join(', ')}
              </p>
            )}
          </div>

          {/* Hangout Button */}
          <button
            onClick={isInHangout ? leaveHangout : joinHangout}
            disabled={joiningHangout}
            className={`relative px-4 py-2 rounded-xl font-medium text-sm transition-all flex items-center gap-2 ${
              isInHangout
                ? 'bg-green-500 text-white hover:bg-green-600'
                : hangoutParticipants.length > 0
                  ? 'bg-gradient-to-r from-pink-500 to-purple-500 text-white animate-pulse hover:from-pink-400 hover:to-purple-400'
                  : 'bg-white/10 text-gray-300 hover:bg-white/20 hover:text-white'
            }`}
          >
            {/* Hangout Icon */}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>

            {joiningHangout ? (
              'Joining...'
            ) : isInHangout ? (
              'Leave Hangout'
            ) : (
              'Hangout'
            )}

            {/* Participant count badge */}
            {hangoutParticipants.length > 0 && !isInHangout && (
              <span className="absolute -top-1 -right-1 w-5 h-5 bg-pink-500 text-white text-xs rounded-full flex items-center justify-center">
                {hangoutParticipants.length}
              </span>
            )}
          </button>
        </div>

        {/* Hangout participants preview */}
        {hangoutParticipants.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-gray-400">In hangout:</span>
            <div className="flex -space-x-2">
              {hangoutParticipants.map((p) => (
                <div
                  key={p.id}
                  className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-400 to-purple-500 border-2 border-gray-900 flex items-center justify-center text-xs"
                  title={p.profile?.screen_name}
                >
                  {p.profile?.screen_name?.[0]?.toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-xs text-pink-400">
              {hangoutParticipants.map(p => p.profile?.screen_name).join(', ')}
            </span>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-400 mx-auto mb-3"></div>
              <p className="text-gray-400 text-sm">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-500">No messages yet. Say hello!</p>
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.sender_id === currentUserId;
            return (
              <div key={message.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex gap-2 max-w-[70%] ${isOwn ? 'flex-row-reverse' : ''}`}>
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-sm flex-shrink-0">
                    👾
                  </div>
                  <div>
                    <p className={`text-xs text-gray-400 mb-1 ${isOwn ? 'text-right' : ''}`}>
                      {message.sender?.screen_name || (isOwn ? profile?.screen_name : 'Unknown')}
                    </p>
                    <div className={`px-4 py-2 rounded-2xl ${
                      isOwn
                        ? 'bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900'
                        : 'bg-white/10 text-white'
                    }`}>
                      {message.content}
                    </div>
                    <p className={`text-xs text-gray-500 mt-1 ${isOwn ? 'text-right' : ''}`}>
                      {new Date(message.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicator */}
      {typingUsers.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5">
          <div className="flex items-center gap-2 text-gray-400 text-sm">
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

      {/* Message Input */}
      <MessageInput
        value={newMessage}
        onChange={handleInputChange}
        onSend={handleSend}
        sending={sending}
      />
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

function MessageInput({ value, onChange, onSend, sending }: {
  value: string;
  onChange: (val: string) => void;
  onSend: (e: React.FormEvent) => void;
  sending: boolean;
}) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [activeCategory, setActiveCategory] = useState('Smileys');
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmojiPicker]);

  const insertEmoji = (emoji: string) => {
    onChange(value + emoji);
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={onSend} className="p-4 border-t border-white/10 bg-gray-900/30">
      <div className="flex gap-3 items-center">
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="p-3 text-gray-400 hover:text-yellow-400 transition-colors rounded-xl hover:bg-white/5"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div className="absolute bottom-14 left-0 bg-gray-900 border border-white/20 rounded-2xl shadow-2xl w-80 overflow-hidden z-50">
              {/* Category Tabs */}
              <div className="flex overflow-x-auto border-b border-white/10 p-2 gap-1 scrollbar-hide">
                {Object.keys(EMOJI_CATEGORIES).map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                      activeCategory === category
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              {/* Emoji Grid */}
              <div className="p-3 h-48 overflow-y-auto">
                <div className="grid grid-cols-8 gap-1">
                  {EMOJI_CATEGORIES[activeCategory as keyof typeof EMOJI_CATEGORIES].map((emoji, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => insertEmoji(emoji)}
                      className="w-8 h-8 flex items-center justify-center text-xl hover:bg-white/10 rounded-lg transition-colors"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400"
        />
        <button
          type="submit"
          disabled={!value.trim() || sending}
          className="px-6 py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 font-bold rounded-xl hover:from-yellow-300 hover:to-orange-400 transition-all disabled:opacity-50"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </form>
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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-white/10">
        <h2 className="text-xl font-bold text-white mb-4">Add Friend</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-xl text-red-200 text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Screen Name</label>
            <input
              type="text"
              value={screenName}
              onChange={(e) => setScreenName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              placeholder="Enter friend's screen name"
              required
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-gray-900 font-bold rounded-xl hover:from-yellow-300 hover:to-orange-400 transition-all disabled:opacity-50"
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
    if (selectedFriends.length === 0) return;

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-md border border-white/10">
        <h2 className="text-xl font-bold text-white mb-4">Create Group Chat</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Group Name (optional)</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400"
              placeholder="Enter group name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-purple-200 mb-2">Select Friends</label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {friends.length === 0 ? (
                <p className="text-gray-400 text-sm">Add some friends first!</p>
              ) : (
                friends.map((friend) => (
                  <label
                    key={friend.id}
                    className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                      selectedFriends.includes(friend.profile!.id)
                        ? 'bg-yellow-500/20 border border-yellow-500/50'
                        : 'bg-white/5 border border-transparent hover:bg-white/10'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFriends.includes(friend.profile!.id)}
                      onChange={() => toggleFriend(friend.profile!.id)}
                      className="hidden"
                    />
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-500 flex items-center justify-center text-sm">
                      👾
                    </div>
                    <span className="text-white">{friend.profile?.screen_name}</span>
                    {selectedFriends.includes(friend.profile!.id) && (
                      <svg className="w-5 h-5 text-yellow-400 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-white/10 text-white rounded-xl hover:bg-white/20 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || selectedFriends.length === 0}
              className="flex-1 py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-bold rounded-xl hover:from-purple-400 hover:to-pink-400 transition-all disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default App;
