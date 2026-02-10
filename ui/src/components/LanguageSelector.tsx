import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import {
    FileJson,
    Braces,
    FileCode,
    FileType,
    Component,
    Code2,
} from 'lucide-react';

// Language configuration with icons
const LANGUAGES = [
    { value: 'json', label: 'JSON', icon: FileJson },
    { value: 'rust', label: 'Rust', icon: Braces },
    { value: 'javascript', label: 'JavaScript', icon: FileCode },
    { value: 'typescript', label: 'TypeScript', icon: FileType },
    { value: 'tsx', label: 'TSX (React)', icon: Component },
    { value: 'python', label: 'Python', icon: Code2 },
    { value: 'go', label: 'Go', icon: Code2 },
    { value: 'ocaml', label: 'OCaml', icon: Code2 },
];

interface LanguageSelectorProps {
    value: string;
    onChange: (language: string) => void;
    isMobile?: boolean;
}

export function LanguageSelector({ value, onChange }: LanguageSelectorProps) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const selectedLanguage = LANGUAGES.find((lang) => lang.value === value);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent | TouchEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isOpen]);

    const handleSelect = (langValue: string) => {
        onChange(langValue);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-white/[0.08] border border-white/[0.1] rounded-full active:bg-white/15 transition-colors"
            >
                {selectedLanguage && (
                    <>
                        <selectedLanguage.icon className="w-3.5 h-3.5 text-blue-400" />
                        <span className="font-medium">{selectedLanguage.label}</span>
                    </>
                )}
                <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <ul className="absolute right-0 mt-2 w-48 bg-[#252526] border border-white/20 rounded-lg shadow-lg z-50 overflow-hidden">
                    {LANGUAGES.map((lang) => {
                        const Icon = lang.icon;
                        const isSelected = lang.value === value;

                        return (
                            <li key={lang.value}>
                                <button
                                    onClick={() => handleSelect(lang.value)}
                                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                                        isSelected
                                            ? 'bg-blue-600/25 text-blue-300'
                                            : 'text-gray-200 active:bg-white/10'
                                    }`}
                                >
                                    <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-400' : 'text-gray-400'}`} />
                                    <span>{lang.label}</span>
                                    {isSelected && (
                                        <span className="ml-auto text-blue-400">✓</span>
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
