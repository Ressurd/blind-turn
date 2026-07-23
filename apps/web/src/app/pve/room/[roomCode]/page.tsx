import { PveCoop } from "../../../../features/pve-coop/PveCoop";

export default async function PveRoomPage({
  params,
}: {
  params: Promise<{ roomCode: string }>;
}) {
  const { roomCode } = await params;
  return <PveCoop initialRoomCode={roomCode.toUpperCase()} />;
}
