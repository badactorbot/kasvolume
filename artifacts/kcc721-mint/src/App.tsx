import { MintScreen } from './components/mint-screen';
import { useMintSession } from './hooks/use-mint-session';

export default function App() {
  const session = useMintSession();
  return <MintScreen session={session} />;
}
