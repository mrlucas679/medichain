import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FamilyGroup } from '@medichain/shared';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { FamilyGroupPage } from './FamilyGroupPage';
import { usePatientAuthStore } from '../store/authStore';
import * as shared from '@medichain/shared';

// Mock the auth store
vi.mock('../store/authStore', () => ({
  usePatientAuthStore: vi.fn(),
}));

// Mock shared utilities
vi.mock('@medichain/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMyFamilyGroups: vi.fn(),
  createFamilyGroup: vi.fn(),
  addFamilyMember: vi.fn(),
}));

// Mock toast actions
vi.mock('../components/Toast', () => ({
  useToastActions: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}));

describe('FamilyGroupPage (Patient)', () => {
  const mockPatient = {
    id: '1',
    healthId: 'HEALTH123',
    fullName: 'Test Patient',
    walletAddress: '5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS60Z',
    role: 'patient',
  };

  const mockGroups = [
    {
      // `family_id` / `family_name`, which is what the API returns. The mock
      // used `group_id` / `group_name` — the names the page normalises *to* —
      // so it only ever exercised the fallback half of that normalisation.
      family_id: 'group1',
      family_name: 'The Smiths',
      primary_account_id: 'HEALTH123',
      members: [
        { patient_id: 'HEALTH123', name: 'Test Patient', relationship: 'Self' },
        { patient_id: 'HEALTH456', name: 'Jane Smith', relationship: 'Spouse' }
      ],
      created_at: 0,
      last_modified: 0,
    }
  ] as unknown as FamilyGroup[];

  beforeEach(() => {
    vi.clearAllMocks();
    (usePatientAuthStore as unknown as Mock).mockReturnValue({
      patient: mockPatient,
    });
    vi.mocked(shared.getMyFamilyGroups).mockResolvedValue({
      success: true,
      groups: mockGroups,
      count: mockGroups.length,
    });
  });

  it('renders family groups page with list of groups', async () => {
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Family Groups/i)).toBeInTheDocument();
      expect(screen.getByText(/The Smiths/i)).toBeInTheDocument();
    });
  });

  it('allows expanding a group to see members', async () => {
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/The Smiths/i)).toBeInTheDocument();
    });

    // Find the toggle button (it's the one with the Chevron)
    const toggleButton = screen.getByRole('button', { name: /The Smiths/i });
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(screen.getByText(/Jane Smith/i)).toBeInTheDocument();
      expect(screen.getByText(/Spouse/i)).toBeInTheDocument();
    });
  });

  it('allows creating a new family group', async () => {
    vi.mocked(shared.createFamilyGroup).mockResolvedValue({
      success: true,
      group_id: 'group2',
      message: 'created',
    });
    
    render(
      <MemoryRouter>
        <FamilyGroupPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Group name/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Group name/i);
    fireEvent.change(input, { target: { value: 'New Family Group' } });

    // 'Create New Group' is the section heading; the submit control is a
    // button labelled 'Create'.
    const createButton = screen.getByRole('button', { name: /^Create$/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(shared.createFamilyGroup).toHaveBeenCalledWith(expect.objectContaining({
        group_name: 'New Family Group',
        primary_contact_id: mockPatient.walletAddress,
      }));
    });
  });
});
