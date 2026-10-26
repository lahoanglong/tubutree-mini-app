import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'zmp-ui';
import { MessageCircle, Phone } from 'lucide-react';
import { supportCopy } from '@tubutree/app-core/support-copy';
import { Button } from './ui/button';
import { Heading, Text } from './ui/text';
import { DEFAULT_SUPPORT, fetchSupportContact } from '../pages/about-data';
import { usePublicConfig } from '../hooks/use-public-config';
import { callPhone } from '../services/zmp-bridge';
import { haptic } from '../utils/haptic';
import { formatPhoneDisplay } from '../utils/phone';

/** Cờ AI tắt: thay vì đẩy thẳng về Trang chủ, nói rõ trợ lý đang nghỉ và chỉ đường hỏi người thật. */
export function AdvisorPaused() {
  const navigate = useNavigate();
  const chatOn = usePublicConfig().chat?.enabled === true;
  const supportQ = useQuery({ queryKey: ['support-contact'], queryFn: fetchSupportContact, staleTime: 10 * 60_000 });
  const hotline = (supportQ.isError ? DEFAULT_SUPPORT : supportQ.data)?.hotline ?? null;
  const copy = supportCopy.advisorPaused;

  return (
    <div data-testid="advisor-paused" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 8, padding: '40px 24px' }}>
      <Heading variant="title-md">{copy.title}</Heading>
      <Text variant="body-md" tone="secondary">{copy.body}</Text>
      {chatOn ? (
        <Button icon={MessageCircle} fullWidth style={{ marginTop: 8 }} onPress={() => navigate('/chat')}>
          {copy.chat}
        </Button>
      ) : (
        hotline && (
          <Button
            icon={Phone}
            fullWidth
            style={{ marginTop: 8 }}
            onPress={() => {
              haptic('light');
              void callPhone(hotline);
            }}
          >
            {copy.call(formatPhoneDisplay(hotline))}
          </Button>
        )
      )}
      <Button variant="secondary" fullWidth onPress={() => navigate('/', { replace: true })}>
        {copy.home}
      </Button>
    </div>
  );
}
