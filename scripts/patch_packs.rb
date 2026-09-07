# frozen_string_literal: true
require 'zlib'
require 'find'

packs_dir = '/app/public/packs'

puts "=== Docurama Build: Scrubbing Legacy Strings in Asset Packs ==="

replacements = [
  ['https://www.docuseal.com/blog/accept-payments-and-request-signatures-with-ease', 'https://docurama.example.com/docs'],
  ['https://www.docuseal.com/pricing', 'https://docurama.example.com/settings'],
  ['https://www.docuseal.com/qualified-electronic-signature', 'https://docurama.example.com/settings/esign'],
  ['https://www.docuseal.com/esign-disclosure', 'https://docurama.example.com/terms'],
  ['https://github.com/docusealco/docuseal', 'https://docurama.example.com'],
  ['https://docuseal.com/sign_up', 'https://docurama.example.com/users/sign_up'],
  ['https://www.docuseal.com/start', 'https://docurama.example.com'],
  ['demo.docuseal.tech', 'demo.docurama.example.com'],
  ['docuseal_modal_container', 'docurama_modal_container'],
  ['docuseal_builder_tab', 'docurama_builder_tab'],
  ['docuseal_clipboard', 'docurama_clipboard'],
  ['webpackChunkdocuseal', 'webpackChunkdocurama'],
  ['DocuSeal', 'Docurama'],
  ['docuseal:', 'docurama:']
]

count = 0
Find.find(packs_dir) do |path|
  next unless path.end_with?('.js', '.css', '.json', '.map')
  content = File.read(path, encoding: 'UTF-8') rescue next
  modified = false
  replacements.each do |old_str, new_str|
    if content.include?(old_str)
      content.gsub!(old_str, new_str)
      modified = true
    end
  end
  if modified
    File.write(path, content, encoding: 'UTF-8')
    count += 1
  end
end

puts "Patched #{count} asset files."

# Delete old precompressed files
Find.find(packs_dir) do |path|
  if path.end_with?('.br', '.gz')
    File.delete(path) rescue nil
  end
end

# Re-gzip patched assets
gzip_count = 0
Find.find(packs_dir) do |path|
  next unless path.end_with?('.js', '.css', '.json')
  gz_path = "#{path}.gz"
  Zlib::GzipWriter.open(gz_path) do |gz|
    gz.write(File.read(path))
  end
  gzip_count += 1
end

puts "Re-compressed #{gzip_count} asset files with gzip."
puts "=== Asset Pack Scrubbing Complete ==="
