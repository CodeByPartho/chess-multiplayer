import { Modal } from './Modal'
import { AuthPanel, type AuthPurpose } from './AuthPanel'

/** header-triggered authentication dialog (guest → account upgrade by default) */
export function AuthModal({
  purpose = 'upgrade',
  onClose,
}: {
  purpose?: AuthPurpose
  onClose: () => void
}) {
  return (
    <Modal title="Account" onClose={onClose} labelledBy="auth-modal-title">
      <AuthPanel purpose={purpose} onDone={onClose} />
      <div className="modal-actions">
        <button className="btn btn-ghost" onClick={onClose}>
          Keep playing as guest
        </button>
      </div>
    </Modal>
  )
}
