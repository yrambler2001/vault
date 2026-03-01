import { useState } from 'react';
import { RefreshCw, Copy, CheckCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { generatePassword, DEFAULT_GENERATOR_OPTIONS } from '../../lib/password-generator';
import type { GeneratorOptions } from '../../lib/password-generator';

export function PasswordGenerator() {
  const [expanded, setExpanded] = useState(false);
  const [options, setOptions] = useState<GeneratorOptions>({ ...DEFAULT_GENERATOR_OPTIONS });
  const [generated, setGenerated] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    setGenerated(generatePassword(options));
    setCopied(false);
  };

  const handleCopy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
      >
        <span className="flex items-center gap-2">
          <RefreshCw size={16} />
          Password Generator
        </span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          {/* Length */}
          <div className="mb-3">
            <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">Length: {options.length}</label>
            <input
              type="range"
              min={4}
              max={128}
              value={options.length}
              onChange={(e) => setOptions({ ...options, length: parseInt(e.target.value) })}
              className="w-full accent-blue-600"
            />
          </div>

          {/* Character sets */}
          <div className="mb-3 flex flex-wrap gap-3">
            {[
              { key: 'uppercase' as const, label: 'ABC' },
              { key: 'lowercase' as const, label: 'abc' },
              { key: 'digits' as const, label: '123' },
              { key: 'special' as const, label: '#$&' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={options[key]}
                  onChange={(e) => setOptions({ ...options, [key]: e.target.checked })}
                  className="accent-blue-600"
                />
                {label}
              </label>
            ))}
          </div>

          {/* Generate button */}
          <button onClick={handleGenerate} className="mb-3 rounded bg-blue-600 px-4 py-1.5 text-sm text-white transition-colors hover:bg-blue-700">
            Generate
          </button>

          {/* Result */}
          {generated && (
            <div className="flex items-center gap-2 rounded border border-gray-200 bg-gray-50 p-2 dark:border-gray-600 dark:bg-gray-700">
              <code className="flex-1 font-mono text-sm break-all text-gray-900 dark:text-gray-100">{generated}</code>
              <button
                onClick={handleCopy}
                className={`shrink-0 rounded p-1.5 ${copied ? 'text-green-500' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'}`}
                title={copied ? 'Copied!' : 'Copy'}
              >
                {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
