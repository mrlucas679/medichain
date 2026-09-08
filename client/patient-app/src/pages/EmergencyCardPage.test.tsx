import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { I18nProvider, ToastProvider } from '@medichain/shared';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmergencyCardPage } from './EmergencyCardPage';
import { usePatientAuthStore } from '../store/authStore';

vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Generate a deterministic data URL so the QR <img> renders predictably.
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,QRMOCK'),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function renderPage() {
  return render(
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <I18nProvider>
        <ToastProvider>
          <EmergencyCardPage />
        </ToastProvider>
      </I18nProvider>
    </BrowserRouter>,
  );
}

const mockPatientId = 'HEALTH123';

const storeState = {
  patient: {
    healthId: mockPatientId,
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
  },
};

describe('EmergencyCardPage (Patient)', () => {

  beforeEach(() => {
    vi.clearAllMocks();

    // One object, created once. Rebuilding it per call hands the component a
    // new `patient` reference on every render, which the real store never does
    // — and a callback depending on it is then rebuilt every render, re-running
    // its effect forever. The page never leaves its loading skeleton.
    (usePatientAuthStore as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (selector: (state: unknown) => unknown) => selector(storeState),
    );

    mockFetch.mockImplementation(() => {
      return Promise.resolve({
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({
          patient_id: 'HEALTH123',
          full_name: 'Test Patient',
          date_of_birth: '1990-01-01',
          emergency_info: {
            blood_type: 'O+',
            allergies: [{ name: 'Peanuts' }],
            chronic_conditions: ['Asthma'],
            current_medications: ['Inhaler'],
            emergency_contacts: [{
              name: 'Jane Doe',
              phone: '+123456789',
              relationship: 'Wife',
            }],
            organ_donor: true,
            dnr_status: false,
          },
          last_updated: '2025-01-01',
        }),
      });
    });
  });

  it('renders emergency card with patient information', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Test Patient/i)).toBeInTheDocument();
      expect(screen.getByText(/O\+/i)).toBeInTheDocument();
      expect(screen.getByText(/Asthma/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Doe/i)).toBeInTheDocument();
    });
  });

  it('renders a real scannable QR code image', async () => {
    renderPage();

    await waitFor(() => {
      const img = screen.getByRole('img', { name: /emergency medical qr code/i });
      expect(img).toHaveAttribute('src', 'data:image/png;base64,QRMOCK');
    });
  });

  it('shows critical medical info including allergies', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/Peanuts/i)).toBeInTheDocument();
    });
  });
});
