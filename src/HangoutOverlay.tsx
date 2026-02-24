import React, { useState, useEffect, useRef } from 'react';
import { supabase } from './lib/supabase';

interface Participant {
  id: string;
  user_id: string;
  avatar_x: number;
  avatar_y: number;
  avatar_type: string;
  profile?: {
    id: string;
    screen_name: string;
    status: string;
  };
}

interface HangoutData {
  conversationId: string;
  participants: Participant[];
}

// High-quality avatar color themes
const AVATAR_THEMES = [
  {
    name: 'coral',
    hair: '#E85D75',
    skin: '#FFE0D6',
    shirt: '#FF6B8A',
    shirtDark: '#E85D75',
    eyes: '#4A4A6A',
    blush: '#FFB4B4'
  },
  {
    name: 'ocean',
    hair: '#4A90D9',
    skin: '#FFE8D6',
    shirt: '#5BA4E8',
    shirtDark: '#4A90D9',
    eyes: '#2D4A6A',
    blush: '#FFB4B4'
  },
  {
    name: 'mint',
    hair: '#4ECDC4',
    skin: '#FFF0E6',
    shirt: '#5DD9D0',
    shirtDark: '#4ECDC4',
    eyes: '#2D5A5A',
    blush: '#FFB4B4'
  },
  {
    name: 'lavender',
    hair: '#9B7ED9',
    skin: '#FFE8E0',
    shirt: '#B08AE8',
    shirtDark: '#9B7ED9',
    eyes: '#4A3D6A',
    blush: '#E8B4D4'
  },
  {
    name: 'sunset',
    hair: '#F5A962',
    skin: '#FFE0D0',
    shirt: '#FFB86B',
    shirtDark: '#F5A962',
    eyes: '#5A4A3A',
    blush: '#FFB4A4'
  },
  {
    name: 'rose',
    hair: '#D4687A',
    skin: '#FFEAE6',
    shirt: '#E87A8C',
    shirtDark: '#D4687A',
    eyes: '#4A3A4A',
    blush: '#FFB4C4'
  },
];

function HangoutOverlay() {
  const [hangoutData, setHangoutData] = useState<HangoutData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Set body class for transparent background and enable click-through
  useEffect(() => {
    document.body.classList.add('hangout-overlay');
    // Make window click-through by default
    window.electronAPI?.setIgnoreMouseEvents?.(true);

    return () => {
      document.body.classList.remove('hangout-overlay');
    };
  }, []);

  useEffect(() => {
    console.log('[HangoutOverlay] Component mounted');

    // Get current user
    supabase.auth.getUser().then(({ data }) => {
      console.log('[HangoutOverlay] Current user:', data.user?.id);
      setCurrentUserId(data.user?.id || null);
    });

    // Listen for hangout updates from main process
    console.log('[HangoutOverlay] Setting up hangout update listener');
    window.electronAPI?.onHangoutUpdate((data) => {
      console.log('[HangoutOverlay] Received hangout update:', data);
      const hangout = data as HangoutData;
      setHangoutData(hangout);
      setParticipants(hangout.participants);
    });

    // Request hangout data after listener is set up
    console.log('[HangoutOverlay] Requesting hangout data');
    window.electronAPI?.requestHangoutData?.();

    // Subscribe to realtime position updates via broadcast
    const channel = supabase
      .channel('hangout-positions')
      .on('broadcast', { event: 'avatar-move' }, ({ payload }) => {
        setParticipants(prev => prev.map(p =>
          p.user_id === payload.userId
            ? { ...p, avatar_x: payload.x, avatar_y: payload.y }
            : p
        ));
      })
      .on('broadcast', { event: 'avatar-action' }, ({ payload }) => {
        // Handle avatar actions/animations
        handleAvatarAction(payload);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Subscribe to database changes for participants joining/leaving
  useEffect(() => {
    if (!hangoutData?.conversationId) return;

    const channel = supabase
      .channel(`hangout-db-${hangoutData.conversationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'hangout_sessions',
        filter: `conversation_id=eq.${hangoutData.conversationId}`
      }, async () => {
        await reloadParticipants();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hangoutData?.conversationId]);

  async function reloadParticipants() {
    if (!hangoutData?.conversationId) return;

    const { data } = await supabase
      .from('hangout_sessions')
      .select('*')
      .eq('conversation_id', hangoutData.conversationId);

    if (data) {
      const userIds = data.map(h => h.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      const updated = data.map(h => ({
        ...h,
        profile: profiles?.find(p => p.id === h.user_id)
      }));
      setParticipants(updated);
    }
  }

  function handleAvatarAction(payload: { userId: string; action: string; targetUserId?: string }) {
    // This will be expanded for avatar interactions
    console.log('Avatar action:', payload);
  }

  if (!hangoutData || participants.length === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {/* Subtle ambient glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-pink-500/5 pointer-events-none" />

      {participants.map((participant, index) => (
        <Avatar
          key={participant.id}
          participant={participant}
          theme={AVATAR_THEMES[index % AVATAR_THEMES.length]}
          isCurrentUser={participant.user_id === currentUserId}
          conversationId={hangoutData.conversationId}
          allParticipants={participants}
        />
      ))}
    </div>
  );
}

function Avatar({ participant, theme, isCurrentUser, conversationId, allParticipants }: {
  participant: Participant;
  theme: typeof AVATAR_THEMES[0];
  isCurrentUser: boolean;
  conversationId: string;
  allParticipants: Participant[];
}) {
  const [position, setPosition] = useState({ x: participant.avatar_x, y: participant.avatar_y });
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [showActions, setShowActions] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Idle animation
  const [breathOffset, setBreathOffset] = useState(0);
  const [blinkState, setBlinkState] = useState(false);

  // Breathing animation
  useEffect(() => {
    const breathInterval = setInterval(() => {
      setBreathOffset(Math.sin(Date.now() / 800) * 2);
    }, 50);

    // Random blinking
    const blinkInterval = setInterval(() => {
      setBlinkState(true);
      setTimeout(() => setBlinkState(false), 150);
    }, 3000 + Math.random() * 2000);

    return () => {
      clearInterval(breathInterval);
      clearInterval(blinkInterval);
    };
  }, []);

  // Sync position from props
  useEffect(() => {
    if (!isDragging) {
      setPosition({ x: participant.avatar_x, y: participant.avatar_y });
    }
  }, [participant.avatar_x, participant.avatar_y, isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isCurrentUser) return;
    e.preventDefault();

    setIsDragging(true);
    setShowActions(false);
    const rect = avatarRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 150, e.clientX - dragOffset.current.x));
      const newY = Math.max(0, Math.min(window.innerHeight - 200, e.clientY - dragOffset.current.y));
      setPosition({ x: newX, y: newY });

      // Broadcast position to others
      supabase.channel('hangout-positions').send({
        type: 'broadcast',
        event: 'avatar-move',
        payload: { userId: participant.user_id, x: newX, y: newY }
      });
    };

    const handleMouseUp = async () => {
      setIsDragging(false);

      // Re-enable click-through
      window.electronAPI?.setIgnoreMouseEvents?.(true);

      // Save position to database
      await supabase
        .from('hangout_sessions')
        .update({ avatar_x: position.x, avatar_y: position.y })
        .eq('conversation_id', conversationId)
        .eq('user_id', participant.user_id);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position, participant.user_id, conversationId]);

  const handleMouseEnter = () => {
    setIsHovering(true);
    // Temporarily enable mouse events on this window so we can interact with avatar
    window.electronAPI?.setIgnoreMouseEvents?.(false);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    if (!isDragging && !showActions) {
      // Re-enable click-through so other apps work
      setTimeout(() => {
        window.electronAPI?.setIgnoreMouseEvents?.(true);
      }, 100);
    }
  };

  const triggerAction = async (action: string) => {
    setCurrentAction(action);
    setShowActions(false);

    // Broadcast action to others
    await supabase.channel('hangout-positions').send({
      type: 'broadcast',
      event: 'avatar-action',
      payload: { userId: participant.user_id, action }
    });

    // Reset action after animation
    setTimeout(() => setCurrentAction(null), 2000);
  };

  // Action animations
  const getActionTransform = () => {
    switch (currentAction) {
      case 'wave':
        return 'rotate(-10deg)';
      case 'jump':
        return 'translateY(-20px)';
      case 'dance':
        return `rotate(${Math.sin(Date.now() / 100) * 5}deg)`;
      default:
        return '';
    }
  };

  return (
    <div
      ref={avatarRef}
      className={`absolute pointer-events-auto select-none transition-all duration-100 ${
        isDragging ? 'cursor-grabbing z-50' : isCurrentUser ? 'cursor-grab' : 'cursor-pointer'
      }`}
      style={{
        left: position.x,
        top: position.y + (isDragging ? 0 : breathOffset),
        transform: getActionTransform(),
        filter: isDragging
          ? 'drop-shadow(0 20px 30px rgba(0,0,0,0.3))'
          : 'drop-shadow(0 8px 16px rgba(0,0,0,0.2))',
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={() => isCurrentUser && setShowActions(!showActions)}
    >
      {/* High Quality Avatar SVG */}
      <svg width="140" height="180" viewBox="0 0 140 180" className="overflow-visible">
        <defs>
          {/* Gradients for depth */}
          <linearGradient id={`skin-${participant.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.skin} />
            <stop offset="100%" stopColor={`${theme.skin}dd`} />
          </linearGradient>
          <linearGradient id={`hair-${participant.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={theme.hair} />
            <stop offset="100%" stopColor={`${theme.hair}cc`} />
          </linearGradient>
          <linearGradient id={`shirt-${participant.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={theme.shirt} />
            <stop offset="100%" stopColor={theme.shirtDark} />
          </linearGradient>

          {/* Shadow filter */}
          <filter id={`shadow-${participant.id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.15"/>
          </filter>
        </defs>

        {/* Body/Shirt */}
        <ellipse
          cx="70" cy="155" rx="45" ry="30"
          fill={`url(#shirt-${participant.id})`}
          filter={`url(#shadow-${participant.id})`}
        />

        {/* Shirt collar detail */}
        <path
          d="M55 130 Q70 140 85 130"
          stroke={theme.shirtDark}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />

        {/* Neck */}
        <rect
          x="58" y="105" width="24" height="30" rx="8"
          fill={`url(#skin-${participant.id})`}
        />

        {/* Head */}
        <ellipse
          cx="70" cy="65" rx="45" ry="50"
          fill={`url(#skin-${participant.id})`}
          filter={`url(#shadow-${participant.id})`}
        />

        {/* Hair back */}
        <ellipse
          cx="70" cy="45" rx="42" ry="35"
          fill={`url(#hair-${participant.id})`}
        />

        {/* Hair sides */}
        <ellipse cx="32" cy="55" rx="14" ry="25" fill={theme.hair} />
        <ellipse cx="108" cy="55" rx="14" ry="25" fill={theme.hair} />

        {/* Hair front/bangs */}
        <path
          d="M35 50 Q50 25 70 30 Q90 25 105 50 Q95 35 70 40 Q45 35 35 50"
          fill={theme.hair}
        />

        {/* Hair shine */}
        <ellipse cx="55" cy="35" rx="12" ry="6" fill="white" opacity="0.2" />

        {/* Ears */}
        <ellipse cx="25" cy="70" rx="8" ry="12" fill={theme.skin} />
        <ellipse cx="115" cy="70" rx="8" ry="12" fill={theme.skin} />

        {/* Eyes */}
        <g>
          {/* Eye whites */}
          <ellipse cx="52" cy="70" rx="12" ry={blinkState ? 2 : 14} fill="white" />
          <ellipse cx="88" cy="70" rx="12" ry={blinkState ? 2 : 14} fill="white" />

          {/* Irises */}
          {!blinkState && (
            <>
              <circle cx="54" cy="72" r="7" fill={theme.eyes} />
              <circle cx="90" cy="72" r="7" fill={theme.eyes} />

              {/* Pupils */}
              <circle cx="55" cy="73" r="4" fill="#1a1a2e" />
              <circle cx="91" cy="73" r="4" fill="#1a1a2e" />

              {/* Eye shine */}
              <circle cx="57" cy="70" r="2.5" fill="white" />
              <circle cx="93" cy="70" r="2.5" fill="white" />
              <circle cx="53" cy="75" r="1.5" fill="white" opacity="0.5" />
              <circle cx="89" cy="75" r="1.5" fill="white" opacity="0.5" />
            </>
          )}
        </g>

        {/* Eyebrows */}
        <path
          d="M40 52 Q52 48 62 52"
          stroke={theme.hair}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M78 52 Q88 48 100 52"
          stroke={theme.hair}
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
        />

        {/* Blush */}
        <ellipse cx="35" cy="82" rx="10" ry="6" fill={theme.blush} opacity="0.4" />
        <ellipse cx="105" cy="82" rx="10" ry="6" fill={theme.blush} opacity="0.4" />

        {/* Nose */}
        <path
          d="M70 78 Q72 85 70 88"
          stroke={`${theme.skin}99`}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />

        {/* Mouth */}
        {currentAction === 'wave' || currentAction === 'jump' ? (
          // Happy open mouth
          <ellipse cx="70" cy="98" rx="8" ry="6" fill="#E85D75" />
        ) : (
          // Normal smile
          <path
            d="M58 95 Q70 105 82 95"
            stroke="#E85D75"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />
        )}

        {/* Wave hand animation */}
        {currentAction === 'wave' && (
          <g className="animate-wave" style={{ transformOrigin: '120px 90px', animation: 'wave 0.5s ease-in-out infinite' }}>
            <ellipse cx="130" cy="85" rx="12" ry="15" fill={theme.skin} />
            <rect x="125" y="70" width="4" height="12" rx="2" fill={theme.skin} transform="rotate(-20 127 76)" />
            <rect x="130" y="68" width="4" height="14" rx="2" fill={theme.skin} transform="rotate(-10 132 75)" />
            <rect x="135" y="70" width="4" height="12" rx="2" fill={theme.skin} />
            <rect x="140" y="72" width="4" height="10" rx="2" fill={theme.skin} transform="rotate(10 142 77)" />
          </g>
        )}
      </svg>

      {/* Name tag */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -bottom-1 px-3 py-1.5 rounded-full text-xs font-bold text-white whitespace-nowrap shadow-lg"
        style={{
          backgroundColor: theme.hair,
          border: `2px solid ${theme.shirtDark}`
        }}
      >
        {participant.profile?.screen_name || 'User'}
        {isCurrentUser && (
          <span className="ml-1 opacity-75">(You)</span>
        )}
      </div>

      {/* Action menu for current user */}
      {isCurrentUser && showActions && (
        <div
          className="absolute -top-16 left-1/2 -translate-x-1/2 flex gap-2 bg-gray-900/90 backdrop-blur-xl rounded-2xl p-2 shadow-2xl border border-white/20"
          onMouseEnter={() => window.electronAPI?.setIgnoreMouseEvents?.(false)}
        >
          <button
            onClick={(e) => { e.stopPropagation(); triggerAction('wave'); }}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors text-xl"
            title="Wave"
          >
            👋
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); triggerAction('jump'); }}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors text-xl"
            title="Jump"
          >
            🦘
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); triggerAction('dance'); }}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors text-xl"
            title="Dance"
          >
            💃
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); triggerAction('heart'); }}
            className="p-2 hover:bg-white/20 rounded-xl transition-colors text-xl"
            title="Love"
          >
            ❤️
          </button>
        </div>
      )}

      {/* Action effects */}
      {currentAction === 'heart' && (
        <div className="absolute -top-8 left-1/2 -translate-x-1/2 text-3xl animate-bounce">
          ❤️
        </div>
      )}
    </div>
  );
}

// Add keyframe animation for wave
const style = document.createElement('style');
style.textContent = `
  @keyframes wave {
    0%, 100% { transform: rotate(-10deg); }
    50% { transform: rotate(20deg); }
  }
`;
document.head.appendChild(style);

export default HangoutOverlay;
