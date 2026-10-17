import type { ReactNode } from 'react';
import { BottomSheet } from '../../shell/BottomSheet';
import { NumericKeypad, type NumericKeypadProps } from './NumericKeypad';

/**
 * Tuş takımı + alttan panel: ölçüm girişinin olağan biçimi. Kayıt sürerken
 * panel kaydırarak kapanmaz (`busy`). "Kaydet → sıradaki" verilirse panel açık
 * kalır ve ifade temizlenir; bu kararı çağıran verir (`onSaveNext` içinde `onChange('')`).
 *
 *   <KeypadSheet open={open} onClose={close} title="Boru DN25" label="Uzunluk" unit="m"
 *     value={expr} onChange={setExpr} onSave={save} onSaveNext={saveAndContinue} />
 */
export function KeypadSheet({
  open,
  onClose,
  title,
  description,
  children,
  ...keypad
}: NumericKeypadProps & {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  /** Tuş takımının üstünde (ör. çap çipleri, blok/kat bilgisi). */
  children?: ReactNode;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!keypad.busy}
      className="m-sheet--keypad"
    >
      {children}
      <NumericKeypad {...keypad} />
    </BottomSheet>
  );
}
