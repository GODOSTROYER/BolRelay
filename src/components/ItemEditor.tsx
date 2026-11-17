import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import type {
  CreateHandoverInput,
  HandoverItem,
  ItemInput,
  ItemPatch,
  WorkAction,
} from '../domain/types';
import { Modal } from './Modal';

const ACTIONS: { value: WorkAction; label: string }[] = [
  { value: 'dispatch', label: 'Dispatch' },
  { value: 'hold', label: 'Hold' },
  { value: 'pack', label: 'Pack' },
  { value: 'collect', label: 'Collect' },
];

function ActionChoice({
  value,
  onChange,
}: {
  value: WorkAction;
  onChange: (value: WorkAction) => void;
}) {
  return (
    <div className="action-choice" role="group" aria-label="Required action">
      {ACTIONS.map((action) => (
        <button
          type="button"
          key={action.value}
          aria-pressed={value === action.value}
          onClick={() => onChange(action.value)}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

export function ItemEditor({
  item,
  onClose,
  onSave,
}: {
  item: HandoverItem;
  onClose: () => void;
  onSave: (patch: ItemPatch) => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [unit, setUnit] = useState(item.unit);
  const [action, setAction] = useState<WorkAction>(item.action);
  const [time, setTime] = useState(item.notBefore ?? '');
  const [condition, setCondition] = useState(item.condition ?? '');
  const [owner, setOwner] = useState(item.owner ?? '');
  const [error, setError] = useState('');
  return (
    <Modal
      title={`Edit ${item.label}`}
      subtitle="A changed instruction reopens this item for a fresh read-back."
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const count = Number(quantity);
          if (!label.trim() || !unit.trim() || !Number.isFinite(count) || count <= 0) {
            setError('Add a name, unit, and a quantity greater than zero.');
            return;
          }
          onSave({
            label: label.trim(),
            quantity: count,
            unit: unit.trim(),
            action,
            notBefore: time || null,
            condition: condition.trim() || null,
            owner: owner.trim() || null,
          });
        }}
      >
        <label className="field">
          Item name
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={80}
            required
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Quantity
            <input
              type="number"
              min="0.001"
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              required
            />
          </label>
          <label className="field">
            Unit
            <input
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              maxLength={30}
              required
            />
          </label>
        </div>
        <div className="field">
          <span>Required action</span>
          <ActionChoice value={action} onChange={setAction} />
        </div>
        <div className="form-grid">
          <label className="field">
            Not before
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
          </label>
          <label className="field">
            Responsible person
            <input
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              placeholder="Optional"
              maxLength={60}
            />
          </label>
        </div>
        <label className="field">
          Release condition
          <input
            value={condition}
            onChange={(event) => setCondition(event.target.value)}
            placeholder="For example: address confirmed"
            maxLength={160}
          />
          <span className="field-help">Leave blank only when there is no prerequisite.</span>
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" data-testid="save-item">
            <Check size={16} />
            Save instruction
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface DraftItem {
  label: string;
  quantity: string;
  unit: string;
  action: WorkAction;
  condition: string;
  time: string;
}
const blankItem = (): DraftItem => ({
  label: '',
  quantity: '1',
  unit: 'parcel',
  action: 'dispatch',
  condition: '',
  time: '',
});

export function NewHandover({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateHandoverInput) => void;
}) {
  const [title, setTitle] = useState('');
  const [outgoingName, setOutgoingName] = useState('');
  const [incomingName, setIncomingName] = useState('');
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [error, setError] = useState('');
  const change = (index: number, patch: Partial<DraftItem>) =>
    setItems((previous) => previous.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  return (
    <Modal
      title="New handover"
      subtitle="Start with the items being handed over. Then capture each person’s words."
      onClose={onClose}
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !title.trim() ||
            !outgoingName.trim() ||
            !incomingName.trim() ||
            items.some(
              (item) =>
                !item.label.trim() ||
                !item.unit.trim() ||
                !Number.isFinite(Number(item.quantity)) ||
                Number(item.quantity) <= 0,
            )
          ) {
            setError('Complete the handover name, people, and each item’s name and quantity.');
            return;
          }
          const labels = items.map((item) => item.label.trim().toLocaleLowerCase());
          if (new Set(labels).size !== labels.length) {
            setError('Give each item a different name so spoken references are clear.');
            return;
          }
          const inputItems: ItemInput[] = items.map((item, index) => ({
            id: `ITEM${index + 1}`,
            label: item.label.trim(),
            aliases: [item.label.trim()],
            quantity: Number(item.quantity),
            unit: item.unit.trim(),
            action: item.action,
            notBefore: item.time || null,
            condition: item.condition.trim() || null,
            owner: null,
          }));
          onCreate({
            title: title.trim(),
            outgoingName: outgoingName.trim(),
            incomingName: incomingName.trim(),
            language: 'en-IN',
            items: inputItems,
          });
        }}
      >
        <label className="field">
          Handover name
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="For example: Evening dispatch"
            maxLength={100}
            required
          />
        </label>
        <div className="form-grid">
          <label className="field">
            Outgoing person
            <input
              value={outgoingName}
              onChange={(event) => setOutgoingName(event.target.value)}
              placeholder="Name"
              maxLength={60}
              required
            />
          </label>
          <label className="field">
            Incoming person
            <input
              value={incomingName}
              onChange={(event) => setIncomingName(event.target.value)}
              placeholder="Name"
              maxLength={60}
              required
            />
          </label>
        </div>
        <div className="new-items-heading">
          <h3>Items in this handover</h3>
          <span>{items.length} / 12</span>
        </div>
        <div className="new-items">
          {items.map((item, index) => (
            <fieldset className="new-item" key={index}>
              <legend>Item {index + 1}</legend>
              <div className="new-item-top">
                <label className="field">
                  Item name {index + 1}
                  <input
                    value={item.label}
                    onChange={(event) => change(index, { label: event.target.value })}
                    placeholder="For example: Blue cartons"
                    maxLength={80}
                    required
                  />
                </label>
                <label className="field quantity-field">
                  Quantity {index + 1}
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    value={item.quantity}
                    onChange={(event) => change(index, { quantity: event.target.value })}
                    required
                  />
                </label>
                {items.length > 1 && (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove item ${index + 1}`}
                    onClick={() => setItems((previous) => previous.filter((_, i) => index !== i))}
                  >
                    <Trash2 size={17} />
                  </button>
                )}
              </div>
              <label className="field">
                Unit {index + 1}
                <input
                  value={item.unit}
                  onChange={(event) => change(index, { unit: event.target.value })}
                  placeholder="For example: parcel or carton"
                  maxLength={30}
                  required
                />
              </label>
              <ActionChoice value={item.action} onChange={(action) => change(index, { action })} />
              <div className="form-grid">
                <label className="field">
                  Not before {index + 1}
                  <input
                    type="time"
                    value={item.time}
                    onChange={(event) => change(index, { time: event.target.value })}
                  />
                </label>
                <label className="field">
                  Condition {index + 1}
                  <input
                    value={item.condition}
                    onChange={(event) => change(index, { condition: event.target.value })}
                    placeholder={
                      item.action === 'hold' ? 'For example: address confirmed' : 'Optional'
                    }
                    maxLength={160}
                  />
                </label>
              </div>
            </fieldset>
          ))}
        </div>
        <button
          type="button"
          className="button button-small"
          disabled={items.length >= 12}
          onClick={() => setItems((previous) => [...previous, blankItem()])}
        >
          <Plus size={16} />
          Add item
        </button>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" data-testid="create-handover">
            Create handover
          </button>
        </div>
      </form>
    </Modal>
  );
}
