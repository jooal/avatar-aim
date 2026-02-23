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

// Avatar color schemes for different users
const AVATAR_THEMES = [
  { primary: '#FF6B6B', secondary: '#EE5A5A', accent: '#FF8787', skin: '#FFD5C8' },
  { primary: '#4ECDC4', secondary: '#3DBDB5', accent: '#6EE7DF', skin: '#FFE4D6' },
  { primary: '#9B59B6', secondary: '#8E44AD', accent: '#B07CC6', skin: '#FFEAA7' },
  { primary: '#3498DB', secondary: '#2980B9', accent: '#5DADE2', skin: '#FFD5C8' },
  { primary: '#F39C12', secondary: '#E67E22', accent: '#F5B041', skin: '#FFE4D6' },
  { primary: '#1ABC9C', secondary: '#16A085', accent: '#48C9B0', skin: '#FFEAA7' },
];

function HangoutOverlay() {
  const [hangoutData, setHangoutData] = useState<HangoutData | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    // Get current user
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUserId(data.user?.id || null);
    });

    // Listen for hangout updates from main process
    window.electronAPI?.onHangoutUpdate((data) => {
      const hangout = data as HangoutData;
      setHangoutData(hangout);
      setParticipants(hangout.participants);
    });

    // Subscribe to realtime position updates
    const channel = supabase
      .channel('hangout-positions')
      .on('broadcast', { event: 'avatar-move' }, ({ payload }) => {
        setParticipants(prev => prev.map(p =>
          p.user_id === payload.userId
            ? { ...p, avatar_x: payload.x, avatar_y: payload.y }
            : p
        ));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Subscribe to database changes for participants
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
        // Reload participants
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
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hangoutData?.conversationId]);

  if (!hangoutData) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none">
      {participants.map((participant, index) => (
        <Avatar
          key={participant.id}
          participant={participant}
          theme={AVATAR_THEMES[index % AVATAR_THEMES.length]}
          isCurrentUser={participant.user_id === currentUserId}
          conversationId={hangoutData.conversationId}
        />
      ))}
    </div>
  );
}

function Avatar({ participant, theme, isCurrentUser, conversationId }: {
  participant: Participant;
  theme: typeof AVATAR_THEMES[0];
  isCurrentUser: boolean;
  conversationId: string;
}) {
  const [position, setPosition] = useState({ x: participant.avatar_x, y: participant.avatar_y });
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // Idle animation state
  const [idleOffset, setIdleOffset] = useState(0);

  useEffect(() => {
    // Gentle floating animation
    const interval = setInterval(() => {
      setIdleOffset(Math.sin(Date.now() / 1000) * 3);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setPosition({ x: participant.avatar_x, y: participant.avatar_y });
  }, [participant.avatar_x, participant.avatar_y]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isCurrentUser) return;

    setIsDragging(true);
    const rect = avatarRef.current?.getBoundingClientRect();
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    // Enable mouse events on window while dragging
    window.electronAPI?.setIgnoreMouseEvents?.(false);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x;
      const newY = e.clientY - dragOffset.current.y;
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

      // Save position to database
      await supabase
        .from('hangout_sessions')
        .update({ avatar_x: position.x, avatar_y: position.y })
        .eq('conversation_id', conversationId)
        .eq('user_id', participant.user_id);

      // Disable mouse events on window when not dragging
      if (!isHovering) {
        window.electronAPI?.setIgnoreMouseEvents?.(true);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, position, participant.user_id, conversationId, isHovering]);

  const handleMouseEnter = () => {
    setIsHovering(true);
    window.electronAPI?.setIgnoreMouseEvents?.(false);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    if (!isDragging) {
      window.electronAPI?.setIgnoreMouseEvents?.(true);
    }
  };

  return (
    <div
      ref={avatarRef}
      className={`absolute pointer-events-auto select-none transition-transform ${
        isDragging ? 'cursor-grabbing scale-105' : isCurrentUser ? 'cursor-grab' : ''
      }`}
      style={{
        left: position.x,
        top: position.y + (isDragging ? 0 : idleOffset),
        transform: `translateZ(0)`,
        filter: isDragging ? 'drop-shadow(0 10px 20px rgba(0,0,0,0.3))' : 'drop-shadow(0 4px 8px rgba(0,0,0,0.2))',
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Avatar Character */}
      <svg width="120" height="160" viewBox="0 0 120 160" className="overflow-visible">
        {/* Body */}
        <ellipse cx="60" cy="130" rx="35" ry="25" fill={theme.primary} />
        <ellipse cx="60" cy="125" rx="32" ry="22" fill={theme.secondary} />

        {/* Body highlight */}
        <ellipse cx="50" cy="120" rx="15" ry="10" fill={theme.accent} opacity="0.5" />

        {/* Neck */}
        <rect x="50" y="85" width="20" height="20" rx="5" fill={theme.skin} />

        {/* Head */}
        <ellipse cx="60" cy="55" rx="38" ry="42" fill={theme.skin} />

        {/* Hair */}
        <ellipse cx="60" cy="30" rx="35" ry="25" fill={theme.primary} />
        <ellipse cx="35" cy="45" rx="12" ry="20" fill={theme.primary} />
        <ellipse cx="85" cy="45" rx="12" ry="20" fill={theme.primary} />

        {/* Hair highlight */}
        <ellipse cx="50" cy="25" rx="15" ry="10" fill={theme.accent} opacity="0.6" />

        {/* Eyes */}
        <ellipse cx="45" cy="55" rx="8" ry="10" fill="white" />
        <ellipse cx="75" cy="55" rx="8" ry="10" fill="white" />

        {/* Pupils */}
        <circle cx="47" cy="57" r="4" fill="#333" />
        <circle cx="77" cy="57" r="4" fill="#333" />

        {/* Eye shine */}
        <circle cx="49" cy="55" r="2" fill="white" />
        <circle cx="79" cy="55" r="2" fill="white" />

        {/* Eyebrows */}
        <path d="M37 45 Q45 42 53 45" stroke={theme.secondary} strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d="M67 45 Q75 42 83 45" stroke={theme.secondary} strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Blush */}
        <ellipse cx="32" cy="65" rx="8" ry="5" fill="#FFB6C1" opacity="0.5" />
        <ellipse cx="88" cy="65" rx="8" ry="5" fill="#FFB6C1" opacity="0.5" />

        {/* Mouth - happy smile */}
        <path d="M50 75 Q60 85 70 75" stroke="#E57373" strokeWidth="3" fill="none" strokeLinecap="round" />

        {/* Arms */}
        <ellipse cx="25" cy="115" rx="12" ry="18" fill={theme.skin} />
        <ellipse cx="95" cy="115" rx="12" ry="18" fill={theme.skin} />
      </svg>

      {/* Name tag */}
      <div
        className="absolute left-1/2 -translate-x-1/2 -bottom-2 px-3 py-1 rounded-full text-xs font-bold text-white whitespace-nowrap"
        style={{ backgroundColor: theme.primary }}
      >
        {participant.profile?.screen_name || 'User'}
        {isCurrentUser && ' (You)'}
      </div>
    </div>
  );
}

export default HangoutOverlay;
