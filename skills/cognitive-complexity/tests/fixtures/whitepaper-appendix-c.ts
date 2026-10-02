// Whitepaper v1.7 Appendix C, the three Java examples translated to TS.
// Comments are the paper's annotations.
/* eslint-disable */
declare const Symbols: any, JavaSymbol: any, TIMED_OUT: number, ABORTED: number, SPECIAL_CHARS: string;
declare function canOverride(s: any): boolean;
declare function checkOverridingParameters(s: any, t: any): boolean | null;
declare function isSlash(ch: string): boolean;
class RollbackException extends Error {}
class WWRetryException extends Error { constructor(public versionHandle: number) { super(); } }
class InterruptedException extends Error {}
class PersistitInterruptedException extends Error { constructor(e: unknown) { super(); } }

class JavaSymbolResolver {
  name = '';

  // From org.sonar.java.resolve.JavaSymbol.java
  overriddenSymbolFrom(classType: any): any {
    if (classType.isUnknown()) { // +1
      return Symbols.unknownMethodSymbol;
    }
    let unknownFound = false;
    const symbols = classType.getSymbol().members().lookup(this.name);
    for (const overrideSymbol of symbols) { // +1
      if (overrideSymbol.isKind(JavaSymbol.MTH) // +2 (nesting = 1)
          && !overrideSymbol.isStatic()) { // +1
        const methodJavaSymbol = overrideSymbol;
        if (canOverride(methodJavaSymbol)) { // +3 (nesting = 2)
          const overriding = checkOverridingParameters(methodJavaSymbol, classType);
          if (overriding == null) { // +4 (nesting = 3)
            if (!unknownFound) { // +5 (nesting = 4)
              unknownFound = true;
            }
          } else if (overriding) { // +1
            return methodJavaSymbol;
          }
        }
      }
    }
    if (unknownFound) { // +1
      return Symbols.unknownMethodSymbol;
    }
    return null;
  } // total complexity = 19
}

class TimelyResource {
  frst: any;
  _persistit: any;

  // From com.persistit.TimelyResource.java. Java's two catch clauses on one
  // try become two nested try statements; `try` adds no nesting, so the
  // scores are unchanged. `synchronized (this)` becomes a plain block.
  addVersion(entry: any, txn: any): void {
    const ti = this._persistit.getTransactionIndex();
    while (true) { // +1
      try {
        try {
          {
            if (this.frst != null) { // +2 (nesting = 1)
              if (this.frst.getVersion() > entry.getVersion()) { // +3 (nesting = 2)
                throw new RollbackException();
              }
              if (txn.isActive()) { // +3 (nesting = 2)
                for // +4 (nesting = 3)
                  (let e = this.frst; e != null; e = e.getPrevious()) {
                  const version = e.getVersion();
                  const depends = ti.wwDependency(version,
                    txn.getTransactionStatus(), 0);
                  if (depends === TIMED_OUT) { // +5 (nesting = 4)
                    throw new WWRetryException(version);
                  }
                  if (depends !== 0 // +5 (nesting = 4)
                      && depends !== ABORTED) { // +1
                    throw new RollbackException();
                  }
                }
              }
            }
            entry.setPrevious(this.frst);
            this.frst = entry;
            break;
          }
        } catch (re: any) { // +2 (nesting = 1)
          try {
            const depends = this._persistit.getTransactionIndex()
              .wwDependency(re.versionHandle, txn.getTransactionStatus(), 1000);
            if (depends !== 0 // +3 (nesting = 2)
                && depends !== ABORTED) { // +1
              throw new RollbackException();
            }
          } catch (ie) { // +3 (nesting = 2)
            throw new PersistitInterruptedException(ie);
          }
        }
      } catch (ie) { // +2 (nesting = 1)
        throw new PersistitInterruptedException(ie);
      }
    }
  } // total complexity = 35
}

// From org.sonar.api.utils.WildcardPattern.java
function toRegexp(antPattern: string, directorySeparator: string): string {
  const escapedDirectorySeparator = '\\' + directorySeparator;
  let sb = '^';
  let i = antPattern.startsWith('/') || // +1
    antPattern.startsWith('\\') ? 1 : 0; // +1
  while (i < antPattern.length) { // +1
    const ch = antPattern.charAt(i);
    if (SPECIAL_CHARS.indexOf(ch) !== -1) { // +2 (nesting = 1)
      sb += '\\' + ch;
    } else if (ch === '*') { // +1
      if (i + 1 < antPattern.length // +3 (nesting = 2)
          && antPattern.charAt(i + 1) === '*') { // +1
        if (i + 2 < antPattern.length // +4 (nesting = 3)
            && isSlash(antPattern.charAt(i + 2))) { // +1
          sb += '(?:.*' + escapedDirectorySeparator + '|)';
          i += 2;
        } else { // +1
          sb += '.*';
          i += 1;
        }
      } else { // +1
        sb += '[^' + escapedDirectorySeparator + ']*?';
      }
    } else if (ch === '?') { // +1
      sb += '[^' + escapedDirectorySeparator + ']';
    } else if (isSlash(ch)) { // +1
      sb += escapedDirectorySeparator;
    } else { // +1
      sb += ch;
    }
    i++;
  }
  sb += '$';
  return sb;
} // total complexity = 20
