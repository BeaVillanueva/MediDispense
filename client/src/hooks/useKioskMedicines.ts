import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { kioskDemo } from "@/lib/apiConfig";
import { kioskApi } from "@/lib/kioskApi";
export function useKioskMedicines() {
  const demo = trpc.kiosk.medicines.useQuery(undefined, {
    enabled: kioskDemo,
    refetchInterval: 5000,
    retry: 1,
  });
  const real = useQuery({
    queryKey: ["php-kiosk-medicines"],
    queryFn: kioskApi.medicines,
    enabled: !kioskDemo,
    refetchInterval: 5000,
    retry: 1,
  });
  return kioskDemo ? demo : real;
}
