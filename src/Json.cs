// Minimal JSON reader for the API payloads (no external dependencies).
// Handles objects, arrays, strings, numbers, booleans, null.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace AzanApp
{
    public sealed class Json
    {
        private readonly string _s;
        private int _i;

        private Json(string s) { _s = s; }

        public static object Parse(string s)
        {
            var p = new Json(s);
            p.SkipWs();
            object v = p.ParseValue();
            p.SkipWs();
            return v;
        }

        public static Dictionary<string, object> ParseObject(string s)
        {
            return Parse(s) as Dictionary<string, object>;
        }

        public static List<object> ParseArray(string s)
        {
            return Parse(s) as List<object>;
        }

        private void SkipWs()
        {
            while (_i < _s.Length && " \t\r\n".IndexOf(_s[_i]) >= 0) _i++;
        }

        private object ParseValue()
        {
            if (_i >= _s.Length) throw new FormatException("Unexpected end of JSON");
            char c = _s[_i];
            switch (c)
            {
                case '{': return ParseObj();
                case '[': return ParseArr();
                case '"': return ParseString();
                case 't': Expect("true"); return (object)true;
                case 'f': Expect("false"); return (object)false;
                case 'n': Expect("null"); return null;
                default: return ParseNumber();
            }
        }

        private void Expect(string word)
        {
            if (string.CompareOrdinal(_s, _i, word, 0, word.Length) != 0)
                throw new FormatException("Invalid JSON at " + _i);
            _i += word.Length;
        }

        private object ParseObj()
        {
            var dict = new Dictionary<string, object>(StringComparer.Ordinal);
            _i++; // {
            SkipWs();
            if (_i < _s.Length && _s[_i] == '}') { _i++; return dict; }
            while (true)
            {
                SkipWs();
                string key = ParseString();
                SkipWs();
                if (_i >= _s.Length || _s[_i] != ':') throw new FormatException("Expected ':' at " + _i);
                _i++;
                SkipWs();
                dict[key] = ParseValue();
                SkipWs();
                if (_i >= _s.Length) throw new FormatException("Unterminated object");
                if (_s[_i] == ',') { _i++; continue; }
                if (_s[_i] == '}') { _i++; return dict; }
                throw new FormatException("Expected ',' or '}' at " + _i);
            }
        }

        private object ParseArr()
        {
            var list = new List<object>();
            _i++; // [
            SkipWs();
            if (_i < _s.Length && _s[_i] == ']') { _i++; return list; }
            while (true)
            {
                SkipWs();
                list.Add(ParseValue());
                SkipWs();
                if (_i >= _s.Length) throw new FormatException("Unterminated array");
                if (_s[_i] == ',') { _i++; continue; }
                if (_s[_i] == ']') { _i++; return list; }
                throw new FormatException("Expected ',' or ']' at " + _i);
            }
        }

        private string ParseString()
        {
            if (_i >= _s.Length || _s[_i] != '"') throw new FormatException("Expected string at " + _i);
            _i++;
            var sb = new StringBuilder();
            while (_i < _s.Length)
            {
                char c = _s[_i++];
                if (c == '"') return sb.ToString();
                if (c == '\\')
                {
                    if (_i >= _s.Length) break;
                    char e = _s[_i++];
                    switch (e)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (_i + 4 <= _s.Length)
                            {
                                sb.Append((char)int.Parse(_s.Substring(_i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                                _i += 4;
                            }
                            break;
                        default: sb.Append(e); break;
                    }
                }
                else sb.Append(c);
            }
            throw new FormatException("Unterminated string");
        }

        private object ParseNumber()
        {
            int start = _i;
            while (_i < _s.Length && "-+.eE0123456789".IndexOf(_s[_i]) >= 0) _i++;
            string num = _s.Substring(start, _i - start);
            if (num.Length == 0) throw new FormatException("Invalid number at " + start);
            long l;
            if (long.TryParse(num, NumberStyles.Integer, CultureInfo.InvariantCulture, out l)
                && l >= int.MinValue && l <= int.MaxValue)
                return l;
            double d;
            if (double.TryParse(num, NumberStyles.Float, CultureInfo.InvariantCulture, out d)) return d;
            throw new FormatException("Invalid number '" + num + "'");
        }

        // ---- typed helpers ----
        public static string Str(Dictionary<string, object> o, string key)
        {
            if (o == null || !o.ContainsKey(key)) return null;
            object v = o[key];
            return v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static long Long(Dictionary<string, object> o, string key)
        {
            object v;
            if (o == null || !o.TryGetValue(key, out v) || v == null) return 0;
            return Convert.ToInt64(v, CultureInfo.InvariantCulture);
        }
    }
}
