require 'yaml'
require 'json'
STDIN.each_line do |l|
  h = JSON.parse(l)
  text = [h['hex']].pack('H*').force_encoding('UTF-8')
  begin
    puts JSON.generate({ ok: YAML.safe_load(text) })
  rescue Exception => e
    puts JSON.generate({ err: e.class.to_s })
  end
end
